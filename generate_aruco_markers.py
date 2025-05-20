import cv2
import numpy as np
import os

def generate_aruco_marker(dictionary, marker_id, size_pixels=400):
    """
    Generate an ArUco marker image.
    
    Args:
        dictionary: The ArUco dictionary to use
        marker_id: The ID of the marker to generate
        size_pixels: Size of the marker in pixels (default: 400)
    
    Returns:
        The generated marker image
    """
    # Generate the marker
    marker = np.zeros((size_pixels, size_pixels), dtype=np.uint8)
    marker = cv2.aruco.generateImageMarker(dictionary, marker_id, size_pixels, marker, 1)
    return marker

def create_svg_from_marker(marker, margin_pixels=50):
    """
    Convert a binary marker image to SVG format.
    
    Args:
        marker: Binary numpy array of the marker
        margin_pixels: White margin around the marker in pixels (default: 50)
    
    Returns:
        SVG string representation of the marker
    """
    marker_size = marker.shape[0]
    total_size = marker_size + 2 * margin_pixels
    
    # Start SVG file with white background
    svg = f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="{total_size}" height="{total_size}" viewBox="0 0 {total_size} {total_size}"
     xmlns="http://www.w3.org/2000/svg" version="1.1">
    <rect width="100%" height="100%" fill="white"/>
    <g transform="translate({margin_pixels}, {margin_pixels})">'''
    
    # Add black rectangles for each marker pixel
    pixel_size = 1
    for y in range(marker_size):
        for x in range(marker_size):
            if marker[y, x] == 0:  # Black pixel
                svg += f'\n        <rect x="{x * pixel_size}" y="{y * pixel_size}" width="{pixel_size}" height="{pixel_size}" fill="black"/>'
    
    # Close SVG
    svg += '\n    </g>\n</svg>'
    return svg

def main():
    # Create output directories if they don't exist
    png_dir = "aruco_markers"
    svg_dir = "svg_tags"
    for directory in [png_dir, svg_dir]:
        if not os.path.exists(directory):
            os.makedirs(directory)
    
    # Initialize the ArUco dictionary we're using
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    
    # Get the number of markers to generate (DICT_4X4_50 supports IDs 0-49)
    print("\nArUco Marker Generator")
    print("----------------------")
    print("This will generate ArUco markers that can be printed and used for machine state detection.")
    print(f"The markers will be saved in both PNG and SVG formats:")
    print(f"- PNG files in '{png_dir}' directory")
    print(f"- SVG files in '{svg_dir}' directory")
    print("\nNote: DICT_4X4_50 dictionary supports markers with IDs from 0 to 49")
    
    while True:
        try:
            num_markers = int(input("\nHow many markers would you like to generate? (1-50): "))
            if 1 <= num_markers <= 50:
                break
            print("Please enter a number between 1 and 50")
        except ValueError:
            print("Please enter a valid number")
    
    print(f"\nGenerating {num_markers} markers...")
    print("Each marker will be shown for 1 second")
    print("Press Ctrl+C to skip the preview\n")
    
    try:
        # Generate the requested number of markers
        for marker_id in range(num_markers):
            # Generate the marker
            marker = generate_aruco_marker(aruco_dict, marker_id)
            
            # Save as PNG
            png_filename = os.path.join(png_dir, f"aruco_marker_{marker_id:03d}.png")
            cv2.imwrite(png_filename, marker)
            
            # Save as SVG
            svg_filename = os.path.join(svg_dir, f"aruco_tag_{marker_id:03d}.svg")
            svg_content = create_svg_from_marker(marker)
            with open(svg_filename, 'w', encoding='utf-8') as f:
                f.write(svg_content)
            
            print(f"Generated marker {marker_id:03d}:")
            print(f"  → PNG: {png_filename}")
            print(f"  → SVG: {svg_filename}")
            
            # Display the marker
            cv2.imshow(f"Marker {marker_id}", marker)
            cv2.waitKey(1000)  # Show each marker for 1 second
        
        print(f"\nSuccessfully generated {num_markers} markers!")
        print("\nPrinting tips:")
        print("- Use the SVG files for best print quality")
        print("- Print in black and white")
        print("- Use non-glossy paper")
        print("- Ensure printer doesn't scale the image")
        print("- Recommended minimum size: 2x2 inches (5x5 cm)")
        
        print("\nPress any key to close all windows...")
        cv2.waitKey(0)
        
    except KeyboardInterrupt:
        print("\n\nPreview interrupted, but all markers were saved successfully!")
    finally:
        cv2.destroyAllWindows()

if __name__ == "__main__":
    main() 