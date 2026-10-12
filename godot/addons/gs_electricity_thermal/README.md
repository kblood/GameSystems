# `gs_electricity_thermal`

Small optional composition adapter between `GSElectricitySystem` energy receipts and
`GSThermalSystem` objects. The circuit and thermal kernel remain independently usable.

Bind passive circuit components (`wire`, `switch`, `fuse`, or `load`) to authored thermal
object IDs. After the matching `network.step(dt)`, pass its `energy_j` dictionary to
`apply_energy_receipt` before advancing the thermal kernel. The adapter converts joules to
kilojoules and preflights the aggregate heat per target before changing any target. Ideal
sources and batteries are excluded; this avoids treating their supplied chemical energy as
heat. Choose bindings and tick order in the host. Do not advance the electrical network a
second time when another adapter owns that interval.

This transfers resistive gameplay heat only. It does not model conductor temperature,
thermal inertia, arc faults, ignition of nearby objects, or code-compliant electrical safety.

Focused tests: `tests/gs_electricity_thermal_tests.gd`.
