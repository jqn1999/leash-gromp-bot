const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval } = require('../helperCommands');

describe('convertSecondstoMinutes', () => {
    test('formats seconds only', () => {
        expect(convertSecondstoMinutes(45)).toBe('45s');
    });

    test('formats minutes and seconds', () => {
        expect(convertSecondstoMinutes(125)).toBe('2m 5s');
    });

    test('formats hours, minutes, and seconds, omitting zero components', () => {
        expect(convertSecondstoMinutes(3600)).toBe('1h 0s');
        expect(convertSecondstoMinutes(3661)).toBe('1h 1m 1s');
    });

    test('formats days for a long cooldown (e.g. the poison potato timer)', () => {
        expect(convertSecondstoMinutes(90000)).toBe('1d 1h 0s');
    });

    test('zero seconds', () => {
        expect(convertSecondstoMinutes(0)).toBe('0s');
    });
});

describe('getUserInteractionDetails', () => {
    test('pulls id, username, and display name off the interaction\'s user', () => {
        const interaction = { user: { id: '1', username: 'raw_name', displayName: 'Display Name' } };
        expect(getUserInteractionDetails(interaction)).toEqual(['1', 'raw_name', 'Display Name']);
    });
});

describe('getRandomFromInterval', () => {
    test('never leaves the [min, max) bound across many samples', () => {
        for (let i = 0; i < 1000; i++) {
            const value = getRandomFromInterval(5, 10);
            expect(value).toBeGreaterThanOrEqual(5);
            expect(value).toBeLessThan(10);
        }
    });
});
