import os
import sys
import math
import json
import argparse
import asyncio
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import cv2
import edge_tts
import imageio_ffmpeg
from scipy.io import wavfile

# Constants
WIDTH = 1920
HEIGHT = 1080
FPS = 24
TOTAL_SECONDS = 120
TOTAL_FRAMES = TOTAL_SECONDS * FPS # 2880 frames
SAMPLE_RATE = 44100
ASSETS_DIR = "cinematic_film_assets"
OUTPUT_VIDEO = "THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4"

# Global Config
VOICE_TYPE = "male" # "male" or "female"
CUSTOM_SCRIPT_PATH = None
CUSTOM_AUDIO_PATH = None
FORCE_VOICE = False

# Scene definitions (Clean state: no default script; custom script loaded via --script)
SCENES = [
    {
        "id": 1,
        "title": "THE HOOK",
        "start": 0, "end": 8,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_clock_hook_1790496886987.jpg"),
        "vo": "",
        "vo_delay": 0.8,
        "zoom": (1.0, 1.15), "pan": (0, 0, -20, -10),
        "subtitle": "",
        "badge": "24:00:00"
    },
    {
        "id": 2,
        "title": "EVERYONE GETS THE SAME TIME",
        "start": 8, "end": 16,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_city_sunrise_1790496911601.jpg"),
        "vo": "",
        "vo_delay": 0.6,
        "zoom": (1.05, 1.18), "pan": (20, 0, -20, 0),
        "subtitle": "",
        "badge": "DAWN / CITY OF MILLIONS"
    },
    {
        "id": 3,
        "title": "THE DISTRACTION",
        "start": 16, "end": 28,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_distraction_phone_1790496935165.jpg"),
        "vo": "",
        "vo_delay": 1.0,
        "zoom": (1.0, 1.12), "pan": (0, 10, 0, -15),
        "subtitle": "",
        "badge": "08:15 AM — DISTRACTION"
    },
    {
        "id": 4,
        "title": "JUST FIVE MINUTES",
        "start": 28, "end": 40,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_just_five_minutes_1790497058827.jpg"),
        "vo": "",
        "vo_delay": 0.8,
        "zoom": (1.12, 1.02), "pan": (-10, 0, 10, 0),
        "subtitle": "",
        "badge": "11:30 AM — UNFINISHED"
    },
    {
        "id": 5,
        "title": "THE REAL ENEMY",
        "start": 40, "end": 50,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_mirror_crack_1790496957061.jpg"),
        "vo": "",
        "vo_delay": 0.5,
        "zoom": (1.0, 1.20), "pan": (0, 0, 0, -10),
        "subtitle": "",
        "badge": "THE CRACKED MIRROR"
    },
    {
        "id": 6,
        "title": "THE RESET",
        "start": 50, "end": 60,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_reset_notebook_1790496985211.jpg"),
        "vo": "",
        "vo_delay": 3.0, # dead silence for first 2.5s
        "zoom": (1.15, 1.02), "pan": (0, -15, 0, 10),
        "subtitle": "",
        "badge": "THE RESET"
    },
    {
        "id": 7,
        "title": "DISCIPLINE",
        "start": 60, "end": 72,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_discipline_flow_1790497082330.jpg"),
        "vo": "",
        "vo_delay": 0.8,
        "zoom": (1.02, 1.14), "pan": (-15, 0, 15, 0),
        "subtitle": "",
        "badge": "FLOW STATE"
    },
    {
        "id": 8,
        "title": "THE REAL TEST",
        "start": 72, "end": 82,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_reset_notebook_1790496985211.jpg"),
        "vo": "",
        "vo_delay": 1.0,
        "zoom": (1.0, 1.15), "pan": (0, 10, 0, -10),
        "subtitle": "",
        "badge": "THE CHOICE OF ATTENTION"
    },
    {
        "id": 9,
        "title": "SMALL ACTIONS TO BIG RESULTS",
        "start": 82, "end": 96,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_discipline_flow_1790497082330.jpg"),
        "vo": "",
        "vo_delay": 0.8,
        "zoom": (1.15, 1.02), "pan": (15, 0, -15, 0),
        "subtitle": "",
        "badge": "DAY 30 — COMPOUND GROWTH"
    },
    {
        "id": 10,
        "title": "THE RESULT",
        "start": 96, "end": 108,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_result_sunrise_1790497006776.jpg"),
        "vo": "",
        "vo_delay": 0.8,
        "zoom": (1.0, 1.16), "pan": (0, 0, 0, -15),
        "subtitle": "",
        "badge": "PROJECT COMPLETED"
    },
    {
        "id": 11,
        "title": "THE CHOICE",
        "start": 108, "end": 116,
        "image": os.path.join(ASSETS_DIR, "the_last_24_hours_result_sunrise_1790497006776.jpg"),
        "vo": "",
        "vo_delay": 0.5,
        "zoom": (1.10, 1.02), "pan": (-10, 0, 10, 0),
        "subtitle": "",
        "badge": "24:00:00 — THE NEW CYCLE"
    },
    {
        "id": 12,
        "title": "FINAL IMPACT",
        "start": 116, "end": 120,
        "image": None, # Pure black frame with typographic climax
        "vo": "",
        "vo_delay": 0,
        "zoom": (1.0, 1.0), "pan": (0, 0, 0, 0),
        "subtitle": "",
        "badge": "EPILOGUE"
    }
]

async def generate_voiceovers():
    if CUSTOM_AUDIO_PATH and os.path.exists(CUSTOM_AUDIO_PATH):
        print(f"[1/4] Using custom user narration audio file: {CUSTOM_AUDIO_PATH} (skipping neural TTS)")
        return

    print(f"[1/4] Generating Neural AI Voice-Over audio files ({VOICE_TYPE.upper()} voice)...")
    os.makedirs("audio_cache", exist_ok=True)

    if VOICE_TYPE == "female":
        voice_name = "en-US-JennyNeural"
        voice_rate = "-6%"
        voice_pitch = "+2Hz"
    else:
        voice_name = "en-US-ChristopherNeural"
        voice_rate = "-8%"
        voice_pitch = "-4Hz"

    for sc in SCENES:
        if sc["vo"]:
            out_file = f"audio_cache/vo_{VOICE_TYPE}_{sc['id']}.mp3"
            if FORCE_VOICE or not os.path.exists(out_file):
                print(f"  Generating {VOICE_TYPE} voice for Scene {sc['id']}: {sc['title']}")
                communicate = edge_tts.Communicate(
                    sc["vo"],
                    voice=voice_name,
                    rate=voice_rate,
                    pitch=voice_pitch
                )
                await communicate.save(out_file)
            else:
                print(f"  Voice file already exists for Scene {sc['id']} ({VOICE_TYPE})")
    print(f"Voice-over generation complete for {VOICE_TYPE} voice.")

def synthesize_soundtrack():
    print("[2/4] Synthesizing 2-minute master cinematic audio & Foley...")
    total_samples = TOTAL_SECONDS * SAMPLE_RATE
    audio = np.zeros(total_samples, dtype=np.float32)

    # Helper for adding ticks
    def add_tick(t, volume=0.25, pitch=800, body=100):
        start_idx = int(t * SAMPLE_RATE)
        tick_len = int(0.04 * SAMPLE_RATE)
        if start_idx + tick_len >= total_samples: return
        t_arr = np.linspace(0, 0.04, tick_len)
        # click
        click = np.sin(2 * np.pi * pitch * np.exp(-t_arr * 80) * t_arr) * np.exp(-t_arr * 100)
        # low body
        body_s = np.sin(2 * np.pi * body * np.exp(-t_arr * 40) * t_arr) * np.exp(-t_arr * 60)
        combined = (click * 0.6 + body_s * 0.4) * volume
        audio[start_idx:start_idx+tick_len] += combined

    # Helper for synth chord
    def add_chord(t_start, duration, freqs, volume=0.12):
        start_idx = int(t_start * SAMPLE_RATE)
        dur_len = int(duration * SAMPLE_RATE)
        if start_idx + dur_len >= total_samples:
            dur_len = total_samples - start_idx
        t_arr = np.linspace(0, duration, dur_len)
        env = np.sin(np.pi * np.clip(t_arr / duration, 0, 1)) ** 1.5
        chord = np.zeros(dur_len, dtype=np.float32)
        for f in freqs:
            chord += np.sin(2 * np.pi * f * t_arr) + 0.3 * np.sin(2 * np.pi * (f*2) * t_arr)
        audio[start_idx:start_idx+dur_len] += chord * env * volume

    # 1. Clock ticks across timeline
    # Act 1: 0 to 16s: 1 tick per second (60 BPM)
    for s in range(0, 16):
        add_tick(s, volume=0.35 if s == 0 else 0.2, pitch=850, body=110)

    # Distraction acceleration: 16 to 40s (accelerating from 1.0s to 0.4s interval)
    curr_t = 16.0
    interval = 1.0
    while curr_t < 40.0:
        add_tick(curr_t, volume=0.22, pitch=1100, body=120)
        interval = max(0.35, interval * 0.96)
        curr_t += interval

    # Surreal confrontation: 40 to 50s: whirlwind ticking + glass crack
    while curr_t < 49.5:
        add_tick(curr_t, volume=0.25, pitch=1400, body=140)
        curr_t += 0.25

    # Glass crack at 49.5s
    crack_start = int(49.5 * SAMPLE_RATE)
    crack_len = int(0.4 * SAMPLE_RATE)
    t_crack = np.linspace(0, 0.4, crack_len)
    crack_noise = (np.random.rand(crack_len).astype(np.float32) * 2 - 1) * np.exp(-t_crack * 20) * 0.6
    audio[crack_start:crack_start+crack_len] += crack_noise

    # Act 2 Reset: 50.0 to 53.0s is COMPLETE DEAD SILENCE
    # Phone desk CLACK at 53.0s
    add_tick(53.0, volume=0.7, pitch=450, body=80)

    # Steady flow clock: 55 to 115s at 72 BPM (~0.833s)
    flow_t = 55.0
    while flow_t < 115.0:
        add_tick(flow_t, volume=0.18, pitch=750, body=95)
        flow_t += 0.833

    # Final tick at 119.0s (isolated sub-bass grandfather clock tick)
    add_tick(119.0, volume=0.8, pitch=520, body=65)

    # 2. Cinematic Musical Chords
    # Scene 1 & 2 Sub Drone (C minor)
    add_chord(0.5, 7.0, [65.41, 130.81, 196.00], volume=0.08)
    add_chord(8.0, 7.5, [65.41, 155.56, 196.00], volume=0.09)

    # Scene 6 The Reset Grand Piano (C minor / Eb)
    add_chord(54.5, 5.0, [130.81, 155.56, 196.00, 261.63], volume=0.14)

    # Scene 7 Flow state piano & strings (Cm - Ab - Eb - Bb)
    add_chord(60.0, 5.5, [130.81, 196.00, 311.13], volume=0.12)
    add_chord(66.0, 5.5, [103.83, 164.81, 261.63], volume=0.12)

    # Scene 8
    add_chord(72.0, 5.0, [130.81, 155.56, 196.00], volume=0.14)
    add_chord(77.0, 4.5, [116.54, 174.61, 233.08], volume=0.14)

    # Scene 9 Compound Growth strings swell (Eb - Bb - Cm - Ab)
    add_chord(82.0, 4.0, [155.56, 233.08, 311.13, 392.00], volume=0.16)
    add_chord(86.0, 4.0, [116.54, 174.61, 233.08, 349.23], volume=0.16)
    add_chord(90.0, 5.5, [130.81, 196.00, 261.63, 311.13], volume=0.18)

    # Scene 10 & 11 Result & Choice (Majestic Triumphant Peak Chord)
    add_chord(96.0, 6.0, [155.56, 233.08, 311.13, 466.16], volume=0.20)
    add_chord(102.0, 6.0, [130.81, 196.00, 261.63, 392.00], volume=0.20)
    add_chord(108.0, 7.0, [155.56, 233.08, 311.13, 392.00], volume=0.15)

    # 3. Load & Overlay Voice-Overs or Custom Uploaded Audio
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

    if CUSTOM_AUDIO_PATH and os.path.exists(CUSTOM_AUDIO_PATH):
        print(f"  Overlaying custom narration audio from: {CUSTOM_AUDIO_PATH}")
        custom_wav = "audio_cache/custom_master_vo.wav"
        import subprocess
        subprocess.run([ffmpeg_exe, "-y", "-i", CUSTOM_AUDIO_PATH, "-ac", "1", "-ar", str(SAMPLE_RATE), custom_wav, "-loglevel", "quiet"], check=True)
        rate, vo_data = wavfile.read(custom_wav)
        vo_data = vo_data.astype(np.float32)
        if vo_data.ndim > 1: vo_data = vo_data[:, 0]
        max_v = np.max(np.abs(vo_data))
        if max_v > 0: vo_data = (vo_data / max_v) * 0.88
        mix_len = min(len(vo_data), total_samples)
        audio[:mix_len] *= 0.60 # duck background under voice
        audio[:mix_len] += vo_data[:mix_len]
    else:
        for sc in SCENES:
            vo_path = f"audio_cache/vo_{VOICE_TYPE}_{sc['id']}.mp3"
            if not os.path.exists(vo_path):
                # Fallback to legacy path if exists
                vo_path = f"audio_cache/vo_{sc['id']}.mp3"
            if os.path.exists(vo_path):
                wav_path = f"audio_cache/vo_{VOICE_TYPE}_{sc['id']}.wav"
                if FORCE_VOICE or not os.path.exists(wav_path):
                    import subprocess
                    subprocess.run([ffmpeg_exe, "-y", "-i", vo_path, "-ac", "1", "-ar", str(SAMPLE_RATE), wav_path, "-loglevel", "quiet"], check=True)
                
                rate, vo_data = wavfile.read(wav_path)
                vo_data = vo_data.astype(np.float32)
                if vo_data.ndim > 1: vo_data = vo_data[:, 0]
                # normalize
                max_v = np.max(np.abs(vo_data))
                if max_v > 0: vo_data = (vo_data / max_v) * 0.85 # strong clear voice

                vo_start_time = sc["start"] + sc.get("vo_delay", 0.5)
                vo_start_idx = int(vo_start_time * SAMPLE_RATE)
                vo_len = len(vo_data)

                if vo_start_idx + vo_len < total_samples:
                    # Duck background slightly under voice
                    audio[vo_start_idx:vo_start_idx+vo_len] *= 0.65
                    audio[vo_start_idx:vo_start_idx+vo_len] += vo_data

    # Final master normalization and soft clipping
    audio = np.tanh(audio * 1.1) * 0.95
    wavfile.write("master_soundtrack.wav", SAMPLE_RATE, (audio * 32767).astype(np.int16))
    print("Master soundtrack generated: master_soundtrack.wav")

def render_video_frames():
    print("[3/4] Rendering 2880 full HD cinema frames (24 fps)...")
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    
    # Preload images
    loaded_images = {}
    for sc in SCENES:
        img_path = sc["image"]
        if img_path and os.path.exists(img_path):
            loaded_images[img_path] = Image.open(img_path).convert("RGB")
        else:
            loaded_images[img_path] = Image.new("RGB", (WIDTH, HEIGHT), (5, 7, 10))

    # Font setup
    try:
        font_serif = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 46)
        font_badge = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 24)
        font_climax_big = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", 68)
        font_climax_sub = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 26)
    except:
        try:
            font_serif = ImageFont.truetype("georgia.ttf", 46)
            font_badge = ImageFont.truetype("consola.ttf", 24)
            font_climax_big = ImageFont.truetype("georgia.ttf", 68)
            font_climax_sub = ImageFont.truetype("consola.ttf", 26)
        except:
            font_serif = ImageFont.load_default()
            font_badge = ImageFont.load_default()
            font_climax_big = ImageFont.load_default()
            font_climax_sub = ImageFont.load_default()

    # Open video writer via ffmpeg pipe directly for pristine quality and speed
    video_raw_output = "temp_video_stream.mp4"
    cmd = [
        ffmpeg_exe,
        "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{WIDTH}x{HEIGHT}",
        "-pix_fmt", "rgb24",
        "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "18",
        video_raw_output
    ]

    import subprocess
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    letterbox_h = int(HEIGHT * 0.08) # 2.39:1 letterbox

    for f in range(TOTAL_FRAMES):
        t = f / FPS
        # Find current scene
        scene = SCENES[-1]
        for sc in SCENES:
            if sc["start"] <= t < sc["end"]:
                scene = sc
                break

        progress_in_scene = (t - scene["start"]) / (scene["end"] - scene["start"])
        progress_in_scene = max(0.0, min(1.0, progress_in_scene))

        # Scene 12: Typographic Climax
        if scene["id"] == 12:
            frame_img = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
            draw = ImageDraw.Draw(frame_img)
            
            # Fade in manifesto
            climax_t = t - 116.0
            if climax_t > 0.5:
                text1 = "DON'T WAIT FOR TIME TO CHANGE YOUR LIFE."
                draw.text((WIDTH//2, HEIGHT//2 - 90), text1, font=font_badge, fill=(160, 160, 160), anchor="mm")
            if climax_t > 1.2:
                text2 = "USE YOUR TIME TO CHANGE YOUR LIFE."
                draw.text((WIDTH//2, HEIGHT//2), text2, font=font_climax_big, fill=(245, 195, 110), anchor="mm")
            if climax_t > 2.0:
                text3 = "TIME MANAGEMENT   •   DISCIPLINE   •   BETTER RESULTS"
                draw.text((WIDTH//2, HEIGHT//2 + 90), text3, font=font_climax_sub, fill=(210, 160, 80), anchor="mm")
        else:
            base_img = loaded_images[scene["image"]]
            orig_w, orig_h = base_img.size

            # Ken Burns zoom & pan
            z_start, z_end = scene["zoom"]
            current_zoom = z_start + (z_end - z_start) * progress_in_scene

            crop_w = int(orig_w / current_zoom)
            crop_h = int(orig_h / current_zoom)

            pan_x1, pan_y1, pan_x2, pan_y2 = scene["pan"]
            cur_pan_x = pan_x1 + (pan_x2 - pan_x1) * progress_in_scene
            cur_pan_y = pan_y1 + (pan_y2 - pan_y1) * progress_in_scene

            left = int((orig_w - crop_w) / 2 + cur_pan_x)
            top = int((orig_h - crop_h) / 2 + cur_pan_y)
            left = max(0, min(orig_w - crop_w, left))
            top = max(0, min(orig_h - crop_h, top))

            cropped = base_img.crop((left, top, left + crop_w, top + crop_h))
            frame_img = cropped.resize((WIDTH, HEIGHT), Image.Resampling.BILINEAR)

            # Draw Overlays
            draw = ImageDraw.Draw(frame_img)

            # 2.39:1 Anamorphic Black Letterbox Bars
            draw.rectangle([(0, 0), (WIDTH, letterbox_h)], fill=(0, 0, 0))
            draw.rectangle([(0, HEIGHT - letterbox_h), (WIDTH, HEIGHT)], fill=(0, 0, 0))

            # HUD Badge (Top Left)
            badge_text = f"SCENE 0{scene['id']}  •  {scene['badge']}"
            draw.text((80, letterbox_h + 35), badge_text, font=font_badge, fill=(240, 200, 120))

            # Subtitle (Bottom Center with shadow)
            sub_text = scene["subtitle"]
            if sub_text:
                sub_y = HEIGHT - letterbox_h - 60
                draw.text((WIDTH//2 + 2, sub_y + 2), sub_text, font=font_serif, fill=(0, 0, 0), anchor="mm")
                draw.text((WIDTH//2, sub_y), sub_text, font=font_serif, fill=(255, 255, 255), anchor="mm")

        # Write RGB24 directly to ffmpeg pipe
        proc.stdin.write(frame_img.tobytes())

        if f % 120 == 0:
            pct = (f / TOTAL_FRAMES) * 100
            print(f"  Rendered {f}/{TOTAL_FRAMES} frames ({pct:.1f}%)...")

    proc.stdin.close()
    proc.wait()
    print("Video stream rendering complete.")

def mux_final_mp4():
    print("[4/4] Muxing master video and high-fidelity audio into MP4...")
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    video_raw = "temp_video_stream.mp4"
    audio_wav = "master_soundtrack.wav"

    cmd = [
        ffmpeg_exe,
        "-y",
        "-i", video_raw,
        "-i", audio_wav,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "256k",
        "-shortest",
        OUTPUT_VIDEO
    ]
    import subprocess
    subprocess.run(cmd, check=True)

    # Clean temporary raw stream
    if os.path.exists(video_raw):
        os.remove(video_raw)

    print(f"\n=======================================================")
    print(f"SUCCESS! Master Film Exported: {OUTPUT_VIDEO}")
    print(f"File Size: {os.path.getsize(OUTPUT_VIDEO) / (1024*1024):.2f} MB")
    print(f"=======================================================\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Render 'The Last 24 Hours' Cinematic Film with custom voice and script.")
    parser.add_argument("--voice", choices=["male", "female"], default="male", help="Narrator voice gender ('male' or 'female')")
    parser.add_argument("--script", type=str, default=None, help="Path to custom screenplay JSON file")
    parser.add_argument("--custom-audio", type=str, default=None, help="Path to custom uploaded narration audio file")
    parser.add_argument("--force-voice", action="store_true", help="Force re-generation of neural voice audio files")
    parser.add_argument("--out", type=str, default=OUTPUT_VIDEO, help="Output MP4 filename")

    args = parser.parse_args()
    VOICE_TYPE = args.voice
    CUSTOM_SCRIPT_PATH = args.script
    CUSTOM_AUDIO_PATH = args.custom_audio
    FORCE_VOICE = args.force_voice
    OUTPUT_VIDEO = args.out

    # Load custom script if provided
    if CUSTOM_SCRIPT_PATH and os.path.exists(CUSTOM_SCRIPT_PATH):
        print(f"Loading custom screenplay script from: {CUSTOM_SCRIPT_PATH}")
        with open(CUSTOM_SCRIPT_PATH, "r", encoding="utf-8") as sf:
            custom_data = json.load(sf)
            for item in custom_data:
                target = next((s for s in SCENES if s["id"] == item["id"]), None)
                if target:
                    if "voScript" in item: target["vo"] = item["voScript"]
                    elif "vo" in item: target["vo"] = item["vo"]
                    if "subtitle" in item: target["subtitle"] = item["subtitle"]
        print("Custom screenplay script loaded into scenes.")

    print(f"\n=======================================================")
    print(f"  RENDERING FILM: THE LAST 24 HOURS")
    print(f"  Narrator Voice: {VOICE_TYPE.upper()} ('{'en-US-ChristopherNeural' if VOICE_TYPE=='male' else 'en-US-JennyNeural'}')")
    if CUSTOM_AUDIO_PATH: print(f"  Custom Audio:   {CUSTOM_AUDIO_PATH}")
    if CUSTOM_SCRIPT_PATH: print(f"  Custom Script:  {CUSTOM_SCRIPT_PATH}")
    print(f"=======================================================\n")

    asyncio.run(generate_voiceovers())
    synthesize_soundtrack()
    render_video_frames()
    mux_final_mp4()
