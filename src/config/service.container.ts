import "reflect-metadata";

import { Container } from "inversify";

import type { ClassRef } from "../types/index.js";

class ServiceContainer {
  private static container: Container;

  constructor() {
    if (!ServiceContainer.container) {
      ServiceContainer.container = new Container();
    }
  }

  getInstance(): Container {
    return ServiceContainer.container;
  }

  public bind<T>(entry: ClassRef<T>): void {
    ServiceContainer.container.bind<T>(Symbol.for(entry.name)).to(entry);
  }

  get<T>(entry: ClassRef<T>): T {
    if (!ServiceContainer.container.isBound(Symbol.for(entry.name))) {
      this.bind(entry);
    }

    return ServiceContainer.container.get<T>(Symbol.for(entry.name));
  }
}

export const serviceContainer = new ServiceContainer();
