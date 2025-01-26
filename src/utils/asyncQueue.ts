import { AbortedError } from "../types";

export class AsyncQueue {
    private queue: Array<{
        func: (...args: any[]) => Promise<any>;
        args: any[];
        resolve: (value: any) => void;
        reject: (reason: any) => void;
    }> = [];
    private isProcessing: boolean = false;

    private async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;
        const { func, args, resolve, reject } = this.queue[0];

        try {
            const result = await func(...args);
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.queue.shift();
            this.isProcessing = false;

            this.processQueue();
        }
    }

    async enqueue<T>(func: (...args: any[]) => Promise<T>, ...args: any[]): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push({ func, args, resolve, reject });
            this.processQueue();
        });
    }

    abort(): void {
        // Reject all pending items in the queue
        const pending = this.queue.slice(this.isProcessing ? 1 : 0);
        pending.forEach(({ reject }) => {
            reject(new AbortedError());
        });
        // Remove all pending items
        this.queue = this.queue.slice(0, this.isProcessing ? 1 : 0);
    }
} 