# VR game performance

VR performance is a frame-time and stability problem, not a desktop-average-FPS target.
The headset's refresh rate determines the delivery interval; missed frames can cause
reprojection and visible judder. Set the target for each device/runtime and record the
actual render, GPU and CPU timings on hardware. Godot's
[general optimization guide](https://docs.godotengine.org/en/stable/tutorials/performance/general_optimization.html)
and [OpenXR settings](https://docs.godotengine.org/en/stable/tutorials/xr/openxr_settings.html)
are references, not substitutes for profiling the export.

## Measure first

Profile representative busy scenes, including many interactables, transparent effects,
NPCs, shadows and UI. Capture CPU main/render/physics time, GPU frame time, allocations,
memory, draw calls, physics bodies and frame misses. Keep separate results for each
target: Steam Frame standalone (Linux ARM64), PCVR and any other standalone mobile
headset are distinct performance targets. Record engine version, renderer, resolution,
foveation and runtime settings for each.

Use the frame-time distribution and worst sustained scene, not only an average. Separate
GPU saturation, CPU script work, driver overhead, physics cost, shader compilation,
loading stalls and thermal throttling. Desktop editor and simulator numbers do not prove
standalone headset performance.

## Rendering

- Use stereo/multiview paths supported by the renderer and target runtime.
- Keep material, shadow and transparency complexity under control; transparent layers
  and large overdraw are costly in stereo.
- Use foveation or variable-rate shading only where device/runtime support is verified;
  inspect edge quality and interaction readability.
- Bake static lighting where practical, limit shadowed lights, and use distance/importance
  tiers for small props, particles and NPC detail.
- Avoid expensive fullscreen effects, dynamic resolution changes that cause visible
  quality pumping, and unnecessary high-resolution render targets.
- Load shaders and assets before they enter the player's view; avoid first-use stutter.

## CPU, physics and interaction

Bound work per tick. Pool hot-path data; avoid allocations, deep scene scans, repeated
resource lookup and synchronous I/O. Use simple collision shapes, collision layers and
query masks. Disable or lower update rates for distant objects, idle ragdolls and hidden
systems. Keep fluid/fire/vehicle simulations fixed-step and bounded; reduce detail with
distance or activity while preserving gameplay outcomes.

Do not sacrifice tracked pose updates or interaction response to save a small amount of
work elsewhere. Run AI and nonessential visuals at lower rates, interpolate their
presentation, and keep input-to-feedback paths short. Be careful with async loading and
garbage collection spikes.

## Comfort, heat and acceptance

Avoid frame-time spikes, camera shake and unstable reprojection. Test sustained sessions
for thermal throttling and battery drain. Define a maximum frame-time budget, acceptable
miss rate and memory ceiling per device, then add a tier or reduce scope when it fails.
Retest after shader, renderer, physics or content changes. A successful build is not a
performance result; attach measured device data to the project backlog.
