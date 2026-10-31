/** Read one file's text. Overridable, which is how the tests run without a disk. */
export type Reader = (path: string, signal?: AbortSignal) => Promise<string>
