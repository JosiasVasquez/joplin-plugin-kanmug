import { AsyncQueue } from "../src/utils/asyncQueue";
import { AbortedError } from "../src/types";

describe("AsyncQueue", () => {
    jest.useFakeTimers();

    it("should process multiple calls in sequence", async () => {
        const queue = new AsyncQueue();
        const results: number[] = [];
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        // Create async functions that resolve after different delays
        const func1 = jest.fn().mockImplementation(async () => {
            await delay(100);
            results.push(1);
            return 1;
        });

        const func2 = jest.fn().mockImplementation(async () => {
            await delay(50);
            results.push(2);
            return 2;
        });

        const func3 = jest.fn().mockImplementation(async () => {
            await delay(25);
            results.push(3);
            return 3;
        });

        const promise1 = queue.enqueue(func1);
        const promise2 = queue.enqueue(func2);
        const promise3 = queue.enqueue(func3);

        jest.advanceTimersByTime(100);
        await Promise.resolve();
        expect(results).toEqual([1]);
        await Promise.resolve();

        jest.advanceTimersByTime(50);
        await Promise.resolve();
        expect(results).toEqual([1, 2]);

        await Promise.resolve();
        jest.advanceTimersByTime(25);
        await Promise.resolve();
        expect(results).toEqual([1, 2, 3]);

        expect(await promise1).toBe(1);
        expect(await promise2).toBe(2);
        expect(await promise3).toBe(3);

        expect(func1).toHaveBeenCalledTimes(1);
        expect(func2).toHaveBeenCalledTimes(1);
        expect(func3).toHaveBeenCalledTimes(1);
    });

    it("should handle function errors", async () => {
        const queue = new AsyncQueue();
        const error = new Error("Test error");
        const mockFn = jest.fn().mockRejectedValue(error);

        const promise = queue.enqueue(mockFn);
        await expect(promise).rejects.toThrow(error);
    });

    it("should abort pending calls", async () => {
        const queue = new AsyncQueue();
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        const func1 = jest.fn().mockImplementation(async () => {
            await delay(100);
            return 1;
        });

        const func2 = jest.fn().mockImplementation(async () => {
            await delay(50);
            return 2;
        });

        // Start first operation
        const promise1 = queue.enqueue(func1);
        // Enqueue second operation
        const promise2 = queue.enqueue(func2);

        // Advance time partially through first operation
        jest.advanceTimersByTime(50);
        await Promise.resolve();

        // Abort remaining operations
        queue.abort();

        // Complete first operation
        jest.advanceTimersByTime(50);
        await Promise.resolve();

        // First operation should complete normally
        await expect(promise1).resolves.toBe(1);
        // Second operation should be aborted
        await expect(promise2).rejects.toThrow(AbortedError);

        // Verify first function was called but second wasn't
        expect(func1).toHaveBeenCalledTimes(1);
        expect(func2).not.toHaveBeenCalled();
    });
});
