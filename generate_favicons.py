from PIL import Image, ImageDraw, ImageFilter

def create_svg():
    return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#151b26" />
      <stop offset="50%" stop-color="#0b0e14" />
      <stop offset="100%" stop-color="#05070a" />
    </linearGradient>

    <!-- Border Glow Gradient -->
    <linearGradient id="goldBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fde68a" />
      <stop offset="35%" stop-color="#e5b364" />
      <stop offset="70%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#b45309" />
    </linearGradient>

    <!-- Clapper Gold Stripes -->
    <linearGradient id="goldStripe" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="25%" stop-color="#fde68a" />
      <stop offset="65%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>

    <!-- Voice Wave Glow Gradient -->
    <linearGradient id="voiceWave" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="20%" stop-color="#fef08a" />
      <stop offset="60%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#b45309" />
    </linearGradient>

    <radialGradient id="centerGlow" cx="50%" cy="54%" r="48%">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.22" />
      <stop offset="60%" stop-color="#e5b364" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#f59e0b" stop-opacity="0" />
    </radialGradient>

    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Base Rounded Container (Squircle) -->
  <rect x="24" y="24" width="464" height="464" rx="108" fill="url(#bgGrad)" stroke="url(#goldBorder)" stroke-width="12" />

  <!-- Ambient Golden Center Glow -->
  <circle cx="256" cy="272" r="170" fill="url(#centerGlow)" />

  <!-- CINEMA CLAPPER + VOICE EQUALIZER -->
  <g transform="translate(0, 12)">
    <!-- Clapper Body (Lower Half) -->
    <g id="clapper-base">
      <path d="M 106 195 L 406 195 A 12 12 0 0 1 418 207 L 418 350 A 24 24 0 0 1 394 374 L 118 374 A 24 24 0 0 1 94 350 L 94 207 A 12 12 0 0 1 106 195 Z"
            fill="#0c1017" stroke="url(#goldBorder)" stroke-width="5" />

      <!-- Inner Clapper Frame Border -->
      <path d="M 112 210 L 400 210 L 400 354 A 12 12 0 0 1 388 366 L 124 366 A 12 12 0 0 1 112 354 Z"
            fill="none" stroke="#e5b364" stroke-opacity="0.28" stroke-width="2" stroke-dasharray="5 4" />

      <!-- Dynamic Voice Equalizer Waveform Bars inside Clapper -->
      <g filter="url(#glow)">
        <!-- Bar 1 -->
        <rect x="146" y="276" width="18" height="46" rx="9" fill="url(#voiceWave)" />
        <!-- Bar 2 -->
        <rect x="178" y="248" width="18" height="78" rx="9" fill="url(#voiceWave)" />
        <!-- Bar 3 -->
        <rect x="210" y="226" width="18" height="106" rx="9" fill="url(#voiceWave)" />
        <!-- Bar 4 (Center peak) -->
        <rect x="244" y="210" width="24" height="126" rx="12" fill="url(#voiceWave)" />
        <!-- Bar 5 -->
        <rect x="284" y="226" width="18" height="106" rx="9" fill="url(#voiceWave)" />
        <!-- Bar 6 -->
        <rect x="316" y="248" width="18" height="78" rx="9" fill="url(#voiceWave)" />
        <!-- Bar 7 -->
        <rect x="348" y="276" width="18" height="46" rx="9" fill="url(#voiceWave)" />
      </g>

      <!-- Baseline Soundwave Axis -->
      <line x1="130" y1="346" x2="382" y2="346" stroke="#f59e0b" stroke-opacity="0.45" stroke-width="3" stroke-linecap="round" />
    </g>

    <!-- Clapper Stick (Top Arm, angled open 14 degrees) -->
    <g transform="rotate(-14 96 192)">
      <!-- Arm Shadow -->
      <rect x="94" y="142" width="316" height="46" rx="8" fill="#000000" opacity="0.45" />
      
      <!-- Arm Base (Dark Obsidian) -->
      <rect x="94" y="138" width="316" height="46" rx="8" fill="#131924" stroke="url(#goldBorder)" stroke-width="4" />

      <!-- Diagonal Gold Clapper Stripes -->
      <g clip-path="url(#clapperArmClip)">
        <clipPath id="clapperArmClip">
          <rect x="94" y="138" width="316" height="46" rx="8" />
        </clipPath>
        <polygon points="120,136 155,136 130,186 95,186" fill="url(#goldStripe)" />
        <polygon points="185,136 220,136 195,186 160,186" fill="url(#goldStripe)" />
        <polygon points="250,136 285,136 260,186 225,186" fill="url(#goldStripe)" />
        <polygon points="315,136 350,136 325,186 290,186" fill="url(#goldStripe)" />
        <polygon points="380,136 415,136 390,186 355,186" fill="url(#goldStripe)" />
      </g>
    </g>

    <!-- Metallic Pivot Hinge / Bolt -->
    <circle cx="96" cy="192" r="11" fill="#fde68a" stroke="#78350f" stroke-width="2.5" />
    <circle cx="96" cy="192" r="4.5" fill="#1e293b" />

    <!-- "REC" Glowing Cinema Dot in top right of clapper base -->
    <circle cx="396" cy="224" r="5" fill="#ef4444" />
    <circle cx="396" cy="224" r="9" fill="#ef4444" opacity="0.4" />
  </g>
</svg>'''

def lerp_color(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

def render_master_image(size=1024):
    """Draws a 1024x1024 pixel-perfect master image of the CineVoice favicon."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = size / 512.0

    # 1. Draw rounded container with gradient
    # Create mask for squircle
    corner_radius = int(108 * scale)
    margin = int(24 * scale)
    box = (margin, margin, size - margin, size - margin)

    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(box, radius=corner_radius, fill=255)

    # Background gradient
    bg_gradient = Image.new("RGBA", (size, size))
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * size)
            if t < 0.5:
                color = lerp_color((21, 27, 38, 255), (11, 14, 20, 255), t * 2.0)
            else:
                color = lerp_color((11, 14, 20, 255), (5, 7, 10, 255), (t - 0.5) * 2.0)
            bg_gradient.putpixel((x, y), color)

    img.paste(bg_gradient, (0, 0), mask)

    # 2. Ambient golden center glow
    glow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)
    cx, cy = int(256 * scale), int(284 * scale)
    r = int(170 * scale)
    glow_draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(245, 158, 11, 40))
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(int(45 * scale)))
    img.alpha_composite(glow_layer)

    # 3. Squircle gold border
    border_draw = ImageDraw.Draw(img)
    stroke_w = int(12 * scale)
    # Layered gold borders for metallic sheen
    border_draw.rounded_rectangle(box, radius=corner_radius, outline=(229, 179, 100, 255), width=stroke_w)
    border_draw.rounded_rectangle((box[0] + 1, box[1] + 1, box[2] - 1, box[3] - 1), 
                                 radius=corner_radius - 1, outline=(253, 230, 138, 200), width=int(2 * scale))

    # 4. Clapper body
    y_offset = int(12 * scale)
    clapper_x1 = int(94 * scale)
    clapper_y1 = int(195 * scale) + y_offset
    clapper_x2 = int(418 * scale)
    clapper_y2 = int(374 * scale) + y_offset

    body_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    body_draw = ImageDraw.Draw(body_layer)
    body_draw.rounded_rectangle((clapper_x1, clapper_y1, clapper_x2, clapper_y2), 
                                radius=int(22 * scale), fill=(12, 16, 23, 255), 
                                outline=(229, 179, 100, 255), width=int(5 * scale))

    # Inner dashed line approximation
    inner_m = int(10 * scale)
    body_draw.rounded_rectangle((clapper_x1 + inner_m, clapper_y1 + inner_m, clapper_x2 - inner_m, clapper_y2 - inner_m),
                                radius=int(14 * scale), outline=(229, 179, 100, 70), width=int(2 * scale))

    # 5. Audio waveform bars
    # Bars specs: [(x, y, w, h)] in 512 coords
    bars = [
        (146, 276, 18, 46),
        (178, 248, 18, 78),
        (210, 226, 18, 106),
        (244, 210, 24, 126), # center
        (284, 226, 18, 106),
        (316, 248, 18, 78),
        (348, 276, 18, 46),
    ]

    wave_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    wave_draw = ImageDraw.Draw(wave_layer)

    for bx, by, bw, bh in bars:
        sx1 = int(bx * scale)
        sy1 = int(by * scale) + y_offset
        sx2 = sx1 + int(bw * scale)
        sy2 = sy1 + int(bh * scale)
        srad = int((bw / 2) * scale)

        # Draw vertical gradient bar
        bar_img = Image.new("RGBA", (sx2 - sx1, sy2 - sy1))
        for row in range(sy2 - sy1):
            prog = row / max(1, sy2 - sy1)
            if prog < 0.25:
                c = lerp_color((255, 255, 255, 255), (253, 230, 138, 255), prog * 4.0)
            elif prog < 0.7:
                c = lerp_color((253, 230, 138, 255), (245, 158, 11, 255), (prog - 0.25) / 0.45)
            else:
                c = lerp_color((245, 158, 11, 255), (180, 83, 9, 255), (prog - 0.7) / 0.3)
            for col in range(sx2 - sx1):
                bar_img.putpixel((col, row), c)

        bar_mask = Image.new("L", (sx2 - sx1, sy2 - sy1), 0)
        bmd = ImageDraw.Draw(bar_mask)
        bmd.rounded_rectangle((0, 0, sx2 - sx1, sy2 - sy1), radius=srad, fill=255)

        wave_layer.paste(bar_img, (sx1, sy1), bar_mask)

    # Baseline axis
    wave_draw.line((int(130 * scale), int(346 * scale) + y_offset, int(382 * scale), int(346 * scale) + y_offset),
                   fill=(245, 158, 11, 130), width=int(3 * scale))

    # REC dot
    rec_x = int(396 * scale)
    rec_y = int(224 * scale) + y_offset
    rec_r = int(5 * scale)
    wave_draw.ellipse((rec_x - int(9 * scale), rec_y - int(9 * scale), rec_x + int(9 * scale), rec_y + int(9 * scale)),
                      fill=(239, 68, 68, 80))
    wave_draw.ellipse((rec_x - rec_r, rec_y - rec_r, rec_x + rec_r, rec_y + rec_r),
                      fill=(239, 68, 68, 255))

    # Combine clapper body and wave
    body_layer.alpha_composite(wave_layer)
    img.alpha_composite(body_layer)

    # 6. Clapper arm (angled stick)
    arm_w = int(316 * scale)
    arm_h = int(46 * scale)
    arm_img = Image.new("RGBA", (arm_w, arm_h), (0, 0, 0, 0))
    arm_draw = ImageDraw.Draw(arm_img)

    # Base stick
    arm_draw.rounded_rectangle((0, 0, arm_w, arm_h), radius=int(8 * scale),
                               fill=(19, 25, 36, 255), outline=(229, 179, 100, 255), width=int(4 * scale))

    # Stripes on stick
    stripes_mask = Image.new("L", (arm_w, arm_h), 0)
    sm_draw = ImageDraw.Draw(stripes_mask)
    sm_draw.rounded_rectangle((0, 0, arm_w, arm_h), radius=int(8 * scale), fill=255)

    stripe_layer = Image.new("RGBA", (arm_w, arm_h), (0, 0, 0, 0))
    sl_draw = ImageDraw.Draw(stripe_layer)

    # Draw diagonal gold stripes
    stripe_w = int(35 * scale)
    slant = int(25 * scale)
    for start_x in [int(x * scale) for x in [26, 91, 156, 221, 286]]:
        poly = [
            (start_x, 0),
            (start_x + stripe_w, 0),
            (start_x + stripe_w - slant, arm_h),
            (start_x - slant, arm_h)
        ]
        sl_draw.polygon(poly, fill=(250, 204, 21, 255))
        # Inner shiny line
        sl_draw.line([(start_x + int(4 * scale), 0), (start_x + int(4 * scale) - slant, arm_h)],
                     fill=(255, 255, 255, 180), width=int(2 * scale))

    arm_img.paste(stripe_layer, (0, 0), stripes_mask)

    # Rotate stick by -14 degrees around pivot (96, 192) in 512 coords
    # Place on an oversized canvas and rotate with high quality bicubic
    stick_canvas = Image.new("RGBA", (size * 2, size * 2), (0, 0, 0, 0))
    pivot_x = int(96 * scale)
    pivot_y = int(192 * scale) + y_offset

    arm_orig_x = int(94 * scale)
    arm_orig_y = int(138 * scale) + y_offset

    # Offset within canvas centered around pivot
    can_cx = size
    can_cy = size
    stick_canvas.paste(arm_img, (can_cx + (arm_orig_x - pivot_x), can_cy + (arm_orig_y - pivot_y)))

    # Rotate around can_cx, can_cy
    rotated_canvas = stick_canvas.rotate(14, resample=Image.Resampling.BICUBIC, center=(can_cx, can_cy))

    # Composite back to main img
    img.alpha_composite(rotated_canvas, (pivot_x - can_cx, pivot_y - can_cy))

    # 7. Metallic pivot hinge
    hinge_draw = ImageDraw.Draw(img)
    hr = int(11 * scale)
    hinge_draw.ellipse((pivot_x - hr, pivot_y - hr, pivot_x + hr, pivot_y + hr),
                       fill=(253, 230, 138, 255), outline=(120, 53, 15, 255), width=int(2.5 * scale))
    hr_inner = int(4.5 * scale)
    hinge_draw.ellipse((pivot_x - hr_inner, pivot_y - hr_inner, pivot_x + hr_inner, pivot_y + hr_inner),
                       fill=(30, 41, 59, 255))

    return img

def main():
    print("1. Generating favicon.svg...")
    with open("favicon.svg", "w", encoding="utf-8") as f:
        f.write(create_svg())

    print("2. Rendering 1024x1024 supersampled master image...")
    master = render_master_image(1024)

    sizes = {
        "favicon-16x16.png": 16,
        "favicon-32x32.png": 32,
        "apple-touch-icon.png": 180,
        "android-chrome-192x192.png": 192,
        "android-chrome-512x512.png": 512,
    }

    for filename, sz in sizes.items():
        print(f"Generating {filename} ({sz}x{sz})...")
        resized = master.resize((sz, sz), Image.Resampling.LANCZOS)
        resized.save(filename, format="PNG")

    print("3. Generating favicon.ico (multi-resolution 16, 32, 48)...")
    # Save from the 1024px master: Pillow's ICO writer silently drops any size
    # larger than the source image, so exporting the 32px variant first produced
    # a two-entry ICO with no 48px frame. Downsampling from the master keeps all
    # three entries crisp.
    master.save("favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    print("4. Generating site.webmanifest...")
    manifest = '''{
  "id": "/",
  "name": "CineVoice Studio — AI Video & Multi-Audio Narration Suite",
  "short_name": "CineVoice",
  "description": "Browser-based AI video and voiceover studio: scene-by-scene scripting, timed AI narration, frame-based scene detection and SRT/VTT caption tooling.",
  "start_url": "/",
  "scope": "/",
  "lang": "en",
  "dir": "ltr",
  "categories": ["video", "productivity", "multimedia"],
  "icons": [
    {
      "src": "favicon-32x32.png",
      "sizes": "32x32",
      "type": "image/png"
    },
    {
      "src": "android-chrome-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "android-chrome-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "favicon.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any"
    },
    {
      "src": "android-chrome-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ],
  "theme_color": "#07090c",
  "background_color": "#07090c",
  "display": "standalone",
  "orientation": "landscape"
}
'''
    # newline="" keeps the LF endings baked into the template. Without it
    # Python's text mode rewrites every \n as \r\n on Windows, so re-running the
    # generator produced a byte-level diff even though the content was identical.
    with open("site.webmanifest", "w", encoding="utf-8", newline="") as f:
        f.write(manifest)

    print("All favicon assets generated successfully!")

if __name__ == "__main__":
    main()
