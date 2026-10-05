#!/usr/bin/env python3
"""Estimate the dominant face position inside a clip window.

Usage: face_center.py <video> <start_seconds> <end_seconds>
Prints a single JSON line: {"found": <frames with a face>, "x": <0-1>, "y": <0-1>}
"""
import json
import statistics
import sys


def main() -> int:
    try:
        import cv2  # type: ignore
    except Exception:  # OpenCV not installed -> caller falls back to manual framing
        print(json.dumps({"found": 0, "error": "opencv-unavailable"}))
        return 0

    path, start, end = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        print(json.dumps({"found": 0, "error": "open-failed"}))
        return 0

    duration = max(0.5, end - start)
    samples = min(90, max(8, int(duration * 2)))
    xs, ys = [], []
    for index in range(samples):
        timestamp = start + duration * (index + 0.5) / samples
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
        ok, frame = capture.read()
        if not ok or frame is None:
            continue
        height, width = frame.shape[:2]
        scale = 480.0 / max(width, height)
        small = cv2.resize(frame, (int(width * scale), int(height * scale))) if scale < 1 else frame
        gray = cv2.equalizeHist(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
        faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=5, minSize=(24, 24))
        if len(faces) == 0:
            continue
        x, y, w, h = max(faces, key=lambda face: face[2] * face[3])
        sh, sw = gray.shape[:2]
        xs.append((x + w / 2) / sw)
        ys.append((y + h / 2) / sh)

    capture.release()
    if not xs:
        print(json.dumps({"found": 0}))
        return 0
    print(json.dumps({"found": len(xs), "x": statistics.median(xs), "y": statistics.median(ys)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
