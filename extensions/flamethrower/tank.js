// Fuel tank of the flamethrower. Pure. All volumes in ml; nothing is ever created or lost: drain() returns what really
// left the tank, refill()/transferFrom() return what really went in (the rest stays with the caller / the canister).

const amount = (ml, name) => { if (typeof ml !== 'number' || !Number.isFinite(ml) || ml < 0) throw new RangeError(`${name} must be a finite number >= 0`); return ml; };

/**
 * @param {{ capacityMl: number, fuelMl?: number }} options  fuelMl defaults to a full tank
 */
export function createFuelTank({ capacityMl, fuelMl = capacityMl } = {}) {
  if (typeof capacityMl !== 'number' || !Number.isFinite(capacityMl) || capacityMl <= 0) throw new RangeError('capacityMl must be a finite number > 0');
  amount(fuelMl, 'fuelMl');
  if (fuelMl > capacityMl) throw new RangeError('fuelMl must not exceed capacityMl');
  let fuel = fuelMl, drained = 0, refilled = 0;
  return {
    capacityMl,
    get fuelMl() { return fuel; },
    get fraction() { return fuel / capacityMl; },
    get empty() { return fuel <= 0; },
    get space() { return capacityMl - fuel; },
    /** Takes up to ml out of the tank; returns the ml actually taken. */
    drain(ml) { const out = Math.min(fuel, amount(ml, 'ml')); fuel -= out; if (fuel < 1e-9) fuel = 0; drained += out; return out; },
    /** Pours up to ml in; returns the ml accepted (capped at the free space). */
    refill(ml) { const accepted = Math.min(capacityMl - fuel, amount(ml, 'ml')); fuel += accepted; refilled += accepted; return accepted; },
    /** Moves fuel from a canister ({ fuelMl } object, mutated) into the tank; returns the ml moved. */
    transferFrom(canister, maxMl = Infinity) {
      if (!canister || typeof canister.fuelMl !== 'number') throw new TypeError('canister must be an object with fuelMl');
      const moved = this.refill(Math.min(amount(canister.fuelMl, 'canister.fuelMl'), maxMl));
      canister.fuelMl -= moved; return moved;
    },
    totals() { return { drainedMl: drained, refilledMl: refilled }; },
  };
}

/** A fuel canister: a plain { fuelMl, capacityMl } the game can hand to tank.transferFrom / flamethrower.refuel. */
export function createCanister(fuelMl = 2000, capacityMl = fuelMl) {
  amount(fuelMl, 'fuelMl'); amount(capacityMl, 'capacityMl');
  return { fuelMl: Math.min(fuelMl, capacityMl), capacityMl };
}
