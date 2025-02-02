import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import type { InquirerReadline } from './read-line.type.mjs';

type HookStore = {
  rl: InquirerReadline;
  hooks: any[];
  hooksCleanup: Array<void | (() => void)>;
  hooksEffect: Array<() => void>;
  index: number;
  handleChange: () => void;
};

const hookStorage = new AsyncLocalStorage<HookStore>();

type Pointer = {
  get(): any;
  set(value: any): void;
  initialized: boolean;
};

function createStore(rl: InquirerReadline) {
  const store: HookStore = {
    rl,
    hooks: [],
    hooksCleanup: [],
    hooksEffect: [],
    index: 0,
    handleChange() {},
  };
  return store;
}

// Run callback in with the hook engine setup.
export function withHooks(rl: InquirerReadline, cb: (store: HookStore) => void) {
  const store = createStore(rl);
  return hookStorage.run(store, () => {
    cb(store);
  });
}

// Safe getStore utility that'll return the store or throw if undefined.
function getStore() {
  const store = hookStorage.getStore();
  if (!store) {
    throw new Error('[Inquirer] Hook functions can only be called from within a prompt');
  }
  return store;
}

export function readline(): InquirerReadline {
  return getStore().rl;
}

// Merge state updates happening within the callback function to avoid multiple renders.
export function withUpdates<T extends (...args: any) => any>(
  fn: T,
): (...args: Parameters<T>) => ReturnType<T> {
  const wrapped = (...args: any): ReturnType<T> => {
    const store = getStore();
    let shouldUpdate = false;
    const oldHandleChange = store.handleChange;
    store.handleChange = () => {
      shouldUpdate = true;
    };

    const returnValue = fn(...args);

    if (shouldUpdate) {
      oldHandleChange();
    }
    store.handleChange = oldHandleChange;

    return returnValue;
  };

  return AsyncResource.bind(wrapped);
}

export function withPointer<Value>(cb: (pointer: Pointer) => Value): Value {
  const store = getStore();

  const { index } = store;
  const pointer: Pointer = {
    get() {
      return store.hooks[index];
    },
    set(value: any) {
      store.hooks[index] = value;
    },
    initialized: index in store.hooks,
  };

  const returnValue = cb(pointer);

  store.index++;
  return returnValue;
}

export function handleChange() {
  getStore().handleChange();
}

export const effectScheduler = {
  queue(cb: (readline: InquirerReadline) => void) {
    const store = getStore();
    const { index } = store;

    store.hooksEffect.push(() => {
      store.hooksCleanup[index]?.();

      const cleanFn = cb(readline());
      if (cleanFn != null && typeof cleanFn !== 'function') {
        throw new Error('useEffect return value must be a cleanup function or nothing.');
      }
      store.hooksCleanup[index] = cleanFn;
    });
  },
  run() {
    const store = getStore();
    withUpdates(() => {
      store.hooksEffect.forEach((effect) => {
        effect();
      });
    })();
    store.hooksEffect.length = 0;
  },
};
