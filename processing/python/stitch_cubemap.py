#!/usr/bin/env python3
import argparse
import sys
import os
import glob
import cv2
import json
import numpy as np

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def face_to_world(face, x, y):
    """
    Maps 2D normalized face coordinates (x, y) in [-1, 1]^2 
    to 3D unit cube direction vector.
    """
    if face == 'front':
        return x, y, -1.0
    elif face == 'back':
        return -x, y, 1.0
    elif face == 'left':
        return -1.0, y, -x
    elif face == 'right':
        return 1.0, y, x
    elif face == 'top':
        return x, 1.0, y
    elif face == 'bottom':
        return x, -1.0, -y
    raise ValueError(f"Unknown face: {face}")

def get_rotation_matrix(yaw_deg, pitch_deg):
    """
    Computes camera rotation matrix R = R_y(yaw) * R_x(pitch).
    Yaw is rotation around Y (up), Pitch is rotation around X (right).
    """
    yaw = np.radians(yaw_deg)
    pitch = np.radians(pitch_deg)
    
    # R_y(yaw)
    R_y = np.array([
        [np.cos(yaw), 0, -np.sin(yaw)],
        [0, 1, 0],
        [np.sin(yaw), 0, np.cos(yaw)]
    ], dtype=np.float64)
    
    # R_x(pitch)
    R_x = np.array([
        [1, 0, 0],
        [0, np.cos(pitch), -np.sin(pitch)],
        [0, np.sin(pitch), np.cos(pitch)]
    ], dtype=np.float64)
    
    return R_y @ R_x

def find_focal_length(images, poses, cx, cy, w_img):
    """
    Matches features between overlapping images and estimates optimal focal length.
    Falls back to a default if matching fails.
    """
    default_f = 0.8 * w_img
    if len(images) < 2:
        return default_f

    # Find ORB features
    orb = cv2.ORB_create(nfeatures=1000)
    keypoints_list = []
    descriptors_list = []
    
    for img in images:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        kp, des = orb.detectAndCompute(gray, None)
        keypoints_list.append(kp)
        descriptors_list.append(des)

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches_all = []
    
    # Match adjacent images
    for i in range(len(images) - 1):
        des1 = descriptors_list[i]
        des2 = descriptors_list[i+1]
        if des1 is None or des2 is None:
            continue
        matches = bf.match(des1, des2)
        matches = sorted(matches, key=lambda x: x.distance)[:100]
        
        # Extract matched point coordinates
        pts1 = np.array([keypoints_list[i][m.queryIdx].pt for m in matches])
        pts2 = np.array([keypoints_list[i+1][m.trainIdx].pt for m in matches])
        
        R1 = get_rotation_matrix(poses[i]['yaw'], poses[i]['pitch'])
        R2 = get_rotation_matrix(poses[i+1]['yaw'], poses[i+1]['pitch'])
        
        matches_all.append((pts1, pts2, R1, R2))

    if not matches_all or sum(len(m[0]) for m in matches_all) < 10:
        eprint("Not enough feature matches to calibrate focal length. Using default.")
        return default_f

    # Optimize focal length (1D grid search)
    f_candidates = np.linspace(0.3 * w_img, 1.5 * w_img, 120)
    best_f = default_f
    min_error = float('inf')

    for f in f_candidates:
        errors = []
        for pts1, pts2, R1, R2 in matches_all:
            # Normalized camera coordinates
            v1 = np.stack([(pts1[:, 0] - cx) / f, (pts1[:, 1] - cy) / f, -np.ones(len(pts1))], axis=1)
            v2 = np.stack([(pts2[:, 0] - cx) / f, (pts2[:, 1] - cy) / f, -np.ones(len(pts2))], axis=1)
            
            # Normalize rays
            v1 /= np.linalg.norm(v1, axis=1, keepdims=True)
            v2 /= np.linalg.norm(v2, axis=1, keepdims=True)
            
            # Rotate to world
            V1 = (R1 @ v1.T).T
            V2 = (R2 @ v2.T).T
            
            # Cosine distance
            cos_dist = 1.0 - np.sum(V1 * V2, axis=1)
            errors.extend(cos_dist)
            
        median_err = np.median(errors)
        if median_err < min_error:
            min_error = median_err
            best_f = f

    eprint(f"Optimized focal length: {best_f:.2f}px (median alignment error: {min_error:.6f})")
    return best_f

def main():
    parser = argparse.ArgumentParser(description="Stitch 3 images into a single cubemap face using homography projections")
    parser.add_argument('--input', required=True, help="Directory containing the 3 face images")
    parser.add_argument('--output', required=True, help="Output stitched face image path")
    parser.add_argument('--poses', required=True, help="Path to poses.json file")
    parser.add_argument('--face', required=True, help="Name of the face being stitched (front, back, left, right, top, bottom)")
    parser.add_argument('--max-dim', type=int, default=1024, help="Max dimension to scale images before stitching")
    args = parser.parse_args()

    input_dir = args.input
    output_path = args.output
    poses_path = args.poses
    face = args.face.lower()
    max_dim = args.max_dim

    # Load poses
    if not os.path.exists(poses_path):
        eprint(f"Poses file not found: {poses_path}")
        sys.exit(1)
        
    with open(poses_path, 'r') as f:
        all_poses = json.load(f)

    # Filter poses for this face
    face_poses = [p for p in all_poses if p['face'].lower() == face]
    if len(face_poses) == 0:
        eprint(f"No poses found in poses.json for face: {face}")
        sys.exit(1)

    # Find the corresponding image files
    images = []
    poses = []
    
    # We sort by file name so it aligns with the sorted image files
    face_poses = sorted(face_poses, key=lambda x: os.path.basename(x['file']))

    for pose in face_poses:
        filename = os.path.basename(pose['file'])
        filepath = os.path.join(input_dir, filename)
        if not os.path.exists(filepath):
            # Try matching with upper/lower case extensions
            base, ext = os.path.splitext(filepath)
            alt_ext = ext.upper() if ext.islower() else ext.lower()
            filepath = base + alt_ext
            
        if not os.path.exists(filepath):
            eprint(f"Image file not found: {filepath}")
            continue

        img = cv2.imread(filepath)
        if img is None:
            eprint(f"Failed to read image: {filepath}")
            continue

        # Scale down if too large
        h, w = img.shape[:2]
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            new_w = int(w * scale)
            new_h = int(h * scale)
            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        images.append(img)
        poses.append(pose)

    if len(images) == 0:
        eprint(f"No valid images found for face: {face}")
        sys.exit(1)

    if len(images) == 1:
        cv2.imwrite(output_path, images[0])
        eprint("Only 1 image found, saved directly.")
        sys.exit(0)

    # We want the output face to be square
    # S is the resolution of the output cubemap face
    S = max_dim
    h_img, w_img = images[0].shape[:2]
    cx = w_img / 2.0
    cy = h_img / 2.0

    # Calibrate focal length
    f = find_focal_length(images, poses, cx, cy, w_img)

    # Initialize output canvas and accumulator
    canvas = np.zeros((S, S, 3), dtype=np.float64)
    weight_sum = np.zeros((S, S, 1), dtype=np.float64)

    # Precompute normalized face coordinates
    u_out = np.arange(S)
    v_out = np.arange(S)
    u_mesh, v_mesh = np.meshgrid(u_out, v_out)

    x_f = (2.0 * u_mesh) / (S - 1) - 1.0
    y_f = 1.0 - (2.0 * v_mesh) / (S - 1)

    # Map face coordinates to 3D unit cube directions
    if face == 'front':
        x_w, y_w, z_w = x_f, y_f, -np.ones_like(x_f)
    elif face == 'back':
        x_w, y_w, z_w = -x_f, y_f, np.ones_like(x_f)
    elif face == 'left':
        x_w, y_w, z_w = -np.ones_like(x_f), y_f, -x_f
    elif face == 'right':
        x_w, y_w, z_w = np.ones_like(x_f), y_f, x_f
    elif face == 'top':
        x_w, y_w, z_w = x_f, np.ones_like(x_f), y_f
    elif face == 'bottom':
        x_w, y_w, z_w = x_f, -np.ones_like(x_f), -y_f
    else:
        raise ValueError(f"Unknown face: {face}")

    # Normalize unit rays
    d = np.sqrt(x_w**2 + y_w**2 + z_w**2)
    x_n = x_w / d
    y_n = y_w / d
    z_n = z_w / d

    for i in range(len(images)):
        img = images[i]
        pose = poses[i]
        
        # Rotation matrix of this camera pose
        R_c = get_rotation_matrix(pose['yaw'], pose['pitch'])
        
        # Rotate unit rays to camera local frame: V_cam = R_c^T * V_world
        # R_c is Orthogonal, so R_c^T is R_c^-1
        # R_c = R_y(yaw) * R_x(pitch) -> R_c^T = R_x(-pitch) * R_y(-yaw)
        yaw_rad = np.radians(pose['yaw'])
        pitch_rad = np.radians(pose['pitch'])
        
        cos_y, sin_y = np.cos(yaw_rad), np.sin(yaw_rad)
        cos_p, sin_p = np.cos(pitch_rad), np.sin(pitch_rad)
        
        # First rotate by -yaw around Y
        x1 = x_n * cos_y + z_n * sin_y
        y1 = y_n
        z1 = -x_n * sin_y + z_n * cos_y
        
        # Then rotate by -pitch around X
        x_c = x1
        y_c = y1 * cos_p + z1 * sin_p
        z_c = -y1 * sin_p + z1 * cos_p

        # Check visibility (z_c < 0 points in front of camera)
        valid = (z_c < -1e-5)
        
        z_c_safe = np.where(valid, z_c, -1.0)
        u_proj = f * (x_c / -z_c_safe) + cx
        v_proj = f * (y_c / -z_c_safe) + cy
        
        # Check boundary
        valid &= (u_proj >= 0) & (u_proj < w_img) & (v_proj >= 0) & (v_proj < h_img)
        
        # Prepare maps for remap
        map_x = u_proj.astype(np.float32)
        map_y = v_proj.astype(np.float32)
        
        # Warp image
        warped = cv2.remap(img, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0,0,0))
        
        # Compute feathering weight map (highest at the center of the camera)
        dx = (u_proj - cx) / cx
        dy = (v_proj - cy) / cy
        dist_sq = dx**2 + dy**2
        
        # Linear weight decay from center
        w_map = np.maximum(0.0, 1.0 - dist_sq)
        w_map = np.where(valid, w_map, 0.0)
        w_map = np.expand_dims(w_map, axis=2)
        
        # Accumulate
        canvas += warped.astype(np.float64) * w_map
        weight_sum += w_map

    # Final blend
    mask = weight_sum > 1e-5
    canvas_norm = np.zeros_like(canvas)
    canvas_norm[mask[:,:,0]] = canvas[mask[:,:,0]] / weight_sum[mask[:,:,0]]
    
    # Convert back to uint8
    final_face = np.clip(canvas_norm, 0, 255).astype(np.uint8)

    # Write output
    cv2.imwrite(output_path, final_face)
    eprint(f"Successfully generated projected stitched face for '{face}' at {output_path}")
    sys.exit(0)

if __name__ == "__main__":
    main()
