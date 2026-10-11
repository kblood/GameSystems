# gs_resource_adapters license and scope

- License: MIT, copyright (c) 2026 Kasper Olesen. The sync tool includes the repository `LICENSE` in generated addon copies.
- Origin: original native GDScript finite tank and energy-store adapters; no third-party code or assets.
- Scope: exposes reversible typed fuel and battery interfaces that can be passed to a host such as Aster. It does not simulate fluid flow, electrical circuits, vehicle motion, or scene ownership.
- Lifetime: callers own the backing `GSSupplyTank` and `GSBatteryAdapter`; adapters do not dispose stores or run background processing.
