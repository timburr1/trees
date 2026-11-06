// Guards the vite.config.ts TZ pin: date-bucketing tests are only meaningful in a zone with daylight-saving changes.
describe('test timezone', () => {
  it('observes daylight saving (America/Denver)', () => {
    const winterOffset = new Date(2026, 0, 15).getTimezoneOffset();
    const summerOffset = new Date(2026, 6, 15).getTimezoneOffset();
    expect(winterOffset).toBe(420);
    expect(summerOffset).toBe(360);
  });
});
