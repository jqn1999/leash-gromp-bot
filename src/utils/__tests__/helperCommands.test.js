const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval, parseAndValidateBet } = require('../helperCommands');

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

// Extracted out of coinflip.js/rps.js's identical inline all/half/numeric parse+validate
// block (see the Potato Roulette + Golden Reels technical design in roadmap.md) — these
// cases mirror what both existing commands' own inline logic already handled.
describe('parseAndValidateBet', () => {
    function fakeInteraction() {
        return { editReply: jest.fn() };
    }

    test('"all" wagers the user\'s entire balance', () => {
        const interaction = fakeInteraction();
        expect(parseAndValidateBet('all', 1000, 'Tester', interaction)).toEqual({ bet: 1000 });
        expect(interaction.editReply).not.toHaveBeenCalled();
    });

    test('"half" wagers half the balance, rounded', () => {
        const interaction = fakeInteraction();
        expect(parseAndValidateBet('half', 1001, 'Tester', interaction)).toEqual({ bet: 501 });
    });

    test('"ALL"/"HALF" are case-insensitive', () => {
        expect(parseAndValidateBet('ALL', 1000, 'Tester', fakeInteraction())).toEqual({ bet: 1000 });
        expect(parseAndValidateBet('HALF', 1000, 'Tester', fakeInteraction())).toEqual({ bet: 500 });
    });

    test('a numeric string is floored to an integer bet', () => {
        expect(parseAndValidateBet('250.9', 1000, 'Tester', fakeInteraction())).toEqual({ bet: 250 });
    });

    test('a non-numeric bet string replies with an error and returns null', () => {
        const interaction = fakeInteraction();
        expect(parseAndValidateBet('banana', 1000, 'Tester', interaction)).toBeNull();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('something went wrong with your bet'));
    });

    test('a zero or negative bet replies with an error and returns null', () => {
        const interaction = fakeInteraction();
        expect(parseAndValidateBet('0', 1000, 'Tester', interaction)).toBeNull();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('positive amounts'));

        const interaction2 = fakeInteraction();
        expect(parseAndValidateBet('-50', 1000, 'Tester', interaction2)).toBeNull();
        expect(interaction2.editReply).toHaveBeenCalledWith(expect.stringContaining('positive amounts'));
    });

    test('a bet greater than the user\'s balance replies with an error and returns null', () => {
        const interaction = fakeInteraction();
        expect(parseAndValidateBet('5000', 1000, 'Tester', interaction)).toBeNull();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('do not have enough potatoes'));
    });

    test('a bet exactly equal to the balance is allowed', () => {
        expect(parseAndValidateBet('1000', 1000, 'Tester', fakeInteraction())).toEqual({ bet: 1000 });
    });
});
