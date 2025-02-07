import { getLoggerFor } from '../logging/LogUtil';
import { Initializer } from './Initializer';

/**
 * Creates and starts an HTTP server.
 */
export class PostgreSQLInitializer extends Initializer  {
  protected readonly logger = getLoggerFor(this);

  public constructor() {
    super();
    this.logger.info("Initialize");
  }

  public async canHandle(): Promise<void> {
    this.logger.info("Can handle");
  }

  public async handle(): Promise<void> {
    this.logger.info("Handle");
  }
}
