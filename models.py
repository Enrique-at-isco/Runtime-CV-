from sqlalchemy import Column, Integer, String, DateTime, Float, create_engine, func, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta
import pytz
import logging
from typing import Dict, List, Optional, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

Base = declarative_base()

# Define CST timezone
CST = pytz.timezone('America/Chicago')

class MachineState(Base):
    __tablename__ = 'machine_states'
    
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(CST))
    state = Column(String, nullable=False)  # 'RUNNING', 'IDLE', 'ERROR'
    duration = Column(Float, nullable=False, default=0.0)  # Duration in seconds
    description = Column(String)
    tag_id = Column(Integer, nullable=True)  # Added tag_id field

    @staticmethod
    def is_working_hours(dt: datetime) -> bool:
        """
        Check if the given datetime is within working hours (7 AM - 5 PM CST, Mon-Fri)
        
        Args:
            dt: Datetime to check
            
        Returns:
            bool: True if within working hours, False otherwise
        """
        try:
            # Convert to CST if not already
            if dt.tzinfo != CST:
                dt = dt.astimezone(CST)
            
            # Check if it's a weekday (Monday = 0, Sunday = 6)
            if dt.weekday() >= 5:  # Saturday or Sunday
                return False
            
            # Check if it's between 7 AM and 5 PM
            return 7 <= dt.hour < 17
        except Exception as e:
            logger.error(f"Error checking working hours: {e}")
            return False

    @staticmethod
    def ensure_timezone(dt: datetime) -> datetime:
        """
        Ensure datetime has CST timezone
        
        Args:
            dt: Datetime to ensure timezone for
            
        Returns:
            datetime: Datetime with CST timezone
        """
        try:
            if dt.tzinfo is None:
                return CST.localize(dt)
            elif dt.tzinfo != CST:
                return dt.astimezone(CST)
            return dt
        except Exception as e:
            logger.error(f"Error ensuring timezone: {e}")
            return dt

    @staticmethod
    def calculate_state_duration(db: Any, state_entry: 'MachineState') -> float:
        """
        Calculate the actual duration of a state by finding the next state change
        
        Args:
            db: Database session
            state_entry: State entry to calculate duration for
            
        Returns:
            float: Duration in seconds
        """
        try:
            # Ensure timestamps have timezone
            state_time = MachineState.ensure_timezone(state_entry.timestamp)
            
            next_state = db.query(MachineState).filter(
                MachineState.timestamp > state_entry.timestamp
            ).order_by(MachineState.timestamp.asc()).first()

            if next_state:
                # Duration is the time until the next state change
                next_time = MachineState.ensure_timezone(next_state.timestamp)
                duration = (next_time - state_time).total_seconds()
            else:
                # If this is the last state, duration is until now
                current_time = datetime.now(CST)
                duration = (current_time - state_time).total_seconds()
            
            return max(0, duration)  # Ensure duration is not negative
        except Exception as e:
            logger.error(f"Error calculating state duration: {e}")
            return 0.0

    @staticmethod
    def update_durations(db: Any) -> None:
        """
        Update durations for all states in the database
        
        Args:
            db: Database session
        """
        try:
            states = db.query(MachineState).order_by(MachineState.timestamp.asc()).all()
            current_time = datetime.now(CST)
            
            for i, state in enumerate(states):
                state_time = MachineState.ensure_timezone(state.timestamp)
                
                if i < len(states) - 1:
                    # Duration until next state
                    next_time = MachineState.ensure_timezone(states[i + 1].timestamp)
                    duration = (next_time - state_time).total_seconds()
                else:
                    # Last state duration is until now
                    duration = (current_time - state_time).total_seconds()
                
                state.duration = max(0, duration)
            
            db.commit()
        except Exception as e:
            logger.error(f"Error updating durations: {e}")
            db.rollback()

# SQLite database URL
DATABASE_URL = "sqlite:///./machine_states.db"

# Create engine with connection pooling and timeout
engine = create_engine(
    DATABASE_URL,
    connect_args={
        "check_same_thread": False,
        "timeout": 30  # 30 second timeout
    },
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800  # Recycle connections after 30 minutes
)

# SessionLocal class with error handling
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False  # Prevent expired object errors
)

# Create all tables
def init_db() -> None:
    """Initialize the database and create all tables"""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Error initializing database: {e}")
        raise

def get_db():
    """Get database session with error handling"""
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error(f"Database session error: {e}")
        db.rollback()
        raise
    finally:
        db.close()

def calculate_hourly_metrics(db: Any, date: datetime) -> Dict[int, Dict[str, Any]]:
    """
    Calculate metrics for each hour of the given date
    
    Args:
        db: Database session
        date: Date to calculate metrics for
        
    Returns:
        Dict[int, Dict[str, Any]]: Hourly metrics
    """
    try:
        # Convert date to CST
        date_cst = MachineState.ensure_timezone(date)
        start_of_day = date_cst.replace(hour=0, minute=0, second=0, microsecond=0)
        
        hourly_metrics = {}
        
        for hour in range(24):
            hour_start = start_of_day + timedelta(hours=hour)
            hour_end = hour_start + timedelta(hours=1)
            
            # Skip non-working hours
            if not MachineState.is_working_hours(hour_start):
                continue
            
            # Get states for this hour
            states = db.query(MachineState).filter(
                MachineState.timestamp >= hour_start,
                MachineState.timestamp < hour_end
            ).all()
            
            if states:
                # Update durations before calculating metrics
                for state in states:
                    state.duration = MachineState.calculate_state_duration(db, state)
                
                total_duration = sum(state.duration for state in states)
                running_duration = sum(state.duration for state in states if state.state == 'RUNNING')
                
                hourly_metrics[hour] = {
                    'total_duration': total_duration,
                    'running_duration': running_duration,
                    'uptime_percentage': (running_duration / total_duration * 100) if total_duration > 0 else 0,
                    'state_counts': {
                        'RUNNING': len([s for s in states if s.state == 'RUNNING']),
                        'IDLE': len([s for s in states if s.state == 'IDLE']),
                        'ERROR': len([s for s in states if s.state == 'ERROR'])
                    }
                }
        
        return hourly_metrics
    except Exception as e:
        logger.error(f"Error calculating hourly metrics: {e}")
        return {}

# Add event listeners for database operations
@event.listens_for(engine, 'connect')
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Set SQLite pragmas for better performance"""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")  # Write-Ahead Logging
    cursor.execute("PRAGMA synchronous=NORMAL")  # Faster writes
    cursor.execute("PRAGMA cache_size=10000")  # Larger cache
    cursor.execute("PRAGMA temp_store=MEMORY")  # Store temp tables in memory
    cursor.close() 