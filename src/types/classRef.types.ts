import type { Newable } from "inversify";

/** Reference to a class that constructs an instance of T. */
export type ClassRef<T> = Newable<T>;
