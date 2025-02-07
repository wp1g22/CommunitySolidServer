import { NotImplementedError } from '@inrupt/solid-client-authn-core';
import { getLoggerFor } from '../logging/LogUtil';
import { Initializer } from './Initializer';
import { Client } from 'pg'; 
import { exec, execSync } from 'child_process';


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
    // throw new NotImplementedError("No PostgreSQL demon running");
  }

  public async handle(): Promise<void> {
    this.logger.info("Handle");
    const socket_file : string = process.cwd() + "/pg_socket";
    const conn_params = {
      host: socket_file,         
      port: 5432,               
      database: 'postgres' 
    };
    const DB_NAME = "documents";
    const DOCUMENTS_TABLE_NAME = "documents";
    const ACL_TABLE_NAME = "document_access";
    var client = new Client(conn_params);
    this.logger.info("Connecting to PostgreSQL...");
    try {
      await client.connect();
    } catch(err) {
      this.logger.info("PostgreSQL not started, attemping to start...");
      execSync("mkdir -p " + socket_file);
      execSync("rm -rf postgresql");
      execSync("initdb postgresql");
      exec(`pg_ctl -D "postgresql" -o "-c unix_socket_directories='` + socket_file + `'" start`);
      this.logger.info("Created new db");
      await this.delay(50);
      while(execSync(`pg_ctl -D "postgresql" -o "-c unix_socket_directories='` + socket_file + `'" status`).toString() === "pg_ctl: no server running")
      {
        this.logger.info("waiting");
      }
      
      this.logger.info("Connecting");
      client = new Client(conn_params);
      await client.connect();
      this.logger.info("Connected!");
    }
    // TODO :: Start PostgreSQL if connection fails
    this.logger.info("Connected to PostgreSQL!");

    const dbCheck = await client.query("SELECT 1 FROM pg_database WHERE datname = '" + DB_NAME + "'");
    if (dbCheck.rowCount === 0) {
      this.logger.info("Database '" + DB_NAME + "' not found. Creating...");
      await client.query('CREATE DATABASE ' + DB_NAME);
      await client.end();

      conn_params.database = DB_NAME;
      client = new Client(conn_params);

      this.logger.info("Connecting to '" + DB_NAME + "' db...");
      await client.connect();
      this.logger.info("Connected to '" + DB_NAME + "' db!");
      await client.query(
        `CREATE TABLE ` + DOCUMENTS_TABLE_NAME + `(
          solid_url text NOT NULL PRIMARY KEY,
          document_text text NOT NULL,
          searchable_tsvector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, document_text)) STORED
      )`);

      await client.query(
        `CREATE TABLE ` + ACL_TABLE_NAME + ` (
          user_id text NOT NULL,
          solid_url text NOT NULL REFERENCES ` + DOCUMENTS_TABLE_NAME + `(solid_url) ON DELETE CASCADE,
          PRIMARY KEY (user_id, solid_url)
      )`);

      await client.query(
        `CREATE POLICY user_access_policy ON ` + DOCUMENTS_TABLE_NAME + ` USING ((EXISTS ( SELECT 1
            FROM ` + ACL_TABLE_NAME + `
            WHERE ((` + ACL_TABLE_NAME + `.solid_url = ` + DOCUMENTS_TABLE_NAME + `.solid_url) AND (` + ACL_TABLE_NAME + `.user_id = current_setting('app.user_id'::text))))))
          `
      );

      await client.query(`ALTER TABLE ` + DOCUMENTS_TABLE_NAME + ` ENABLE ROW LEVEL SECURITY`);

      await client.query(`ALTER TABLE ONLY ` + DOCUMENTS_TABLE_NAME + ` FORCE ROW LEVEL SECURITY`);

      await client.query(`CREATE INDEX document_access_idx ON ` + ACL_TABLE_NAME + ` USING btree (user_id, solid_url)`);

      await client.query(`CREATE INDEX documents_search_idx ON ` + DOCUMENTS_TABLE_NAME + ` USING gin (searchable_tsvector)`);

      await client.end();
      this.logger.info("Database '" + DB_NAME + "' created.");

    } else {
      this.logger.info("Database '" + DB_NAME + "' already exists.");
    }
    
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
