import { chooseTickStepMm, buildTicks } from '../../../shared/js/rulerTicks';

describe('chooseTickStepMm', () => {
  it('uses 1mm steps when a millimetre is comfortably wide on screen', () => {
    // 1mm = 50px on screen, well past the 40px floor.
    expect(chooseTickStepMm(1 / 50)).toBe(1);
  });

  it('climbs to a coarser step as the drawing shrinks', () => {
    // 1mm = 10px, so a 1mm step would label every 10px. 5mm gives 50px.
    expect(chooseTickStepMm(1 / 10)).toBe(5);
  });

  it('caps at 100mm when even that is too tight', () => {
    // 1mm = 0.1px: a 100mm step is still only 10px, but there is nothing coarser.
    expect(chooseTickStepMm(10)).toBe(100);
  });

  it('honours a custom minimum label spacing', () => {
    // 1mm = 10px. With a 20px floor a 2mm step (20px) is enough.
    expect(chooseTickStepMm(1 / 10, 20)).toBe(2);
  });
});

describe('buildTicks', () => {
  it('emits a major tick at zero', () => {
    const ticks = buildTicks({ lengthPx: 500, mmPerPx: 1 / 50 });
    expect(ticks[0]).toEqual({ px: 0, mm: 0, major: true });
  });

  it('spaces majors by the chosen step and minors at one fifth of it', () => {
    // 1mm = 50px → step 1mm → majors every 50px, minors every 10px.
    const ticks = buildTicks({ lengthPx: 100, mmPerPx: 1 / 50 });
    const majors = ticks.filter((t) => t.major);
    expect(majors.map((t) => t.mm)).toEqual([0, 1, 2]);
    expect(majors.map((t) => t.px)).toEqual([0, 50, 100]);
    const minors = ticks.filter((t) => !t.major);
    // 5 subdivisions per major means 4 INTERIOR minors per interval; 2 intervals -> 8.
    expect(minors.length).toBe(8);
  });

  it('never emits a tick past the ruler length', () => {
    const ticks = buildTicks({ lengthPx: 120, mmPerPx: 1 / 50 });
    ticks.forEach((t) => expect(t.px).toBeLessThanOrEqual(120));
  });

  it('keeps labelled ticks at least the minimum spacing apart', () => {
    // Sweep a range of scales; the floor must hold at every one of them.
    [0.01, 0.05, 0.2, 1, 2.5].forEach((mmPerPx) => {
      const majors = buildTicks({ lengthPx: 800, mmPerPx }).filter((t) => t.major);
      for (let i = 1; i < majors.length; i++) {
        expect(majors[i].px - majors[i - 1].px).toBeGreaterThanOrEqual(40);
      }
    });
  });

  it('falls back to the coarsest step when even that cannot meet the spacing floor', () => {
    // 1px = 5mm. A 100mm step is only 20px on screen, but there is nothing
    // coarser, so the ruler stays sparse rather than disappearing.
    expect(chooseTickStepMm(5)).toBe(100);
    const majors = buildTicks({ lengthPx: 800, mmPerPx: 5 }).filter((t) => t.major);
    expect(majors.length).toBeGreaterThan(1);
    expect(majors[1].px - majors[0].px).toBeCloseTo(20, 6);
  });

  it('returns nothing when there is no physical scale', () => {
    expect(buildTicks({ lengthPx: 500, mmPerPx: 0 })).toEqual([]);
    expect(buildTicks({ lengthPx: 500, mmPerPx: -1 })).toEqual([]);
  });

  it('returns nothing for a zero-length ruler', () => {
    expect(buildTicks({ lengthPx: 0, mmPerPx: 1 / 50 })).toEqual([]);
  });
});
