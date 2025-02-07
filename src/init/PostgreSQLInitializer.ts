import { NotImplementedError } from '@inrupt/solid-client-authn-core';
import { getLoggerFor } from '../logging/LogUtil';
import { Initializer } from './Initializer';
import { Client } from 'pg'; 
import { exec, execSync } from 'child_process';
import * as fs from 'fs';


/**
 * Creates and starts an HTTP server.
 */
export class PostgreSQLInitializer extends Initializer  {
  protected readonly logger = getLoggerFor(this);

  public async canHandle(): Promise<void> {
    // throw new NotImplementedError("No PostgreSQL demon running");
  }

  public async handle(): Promise<void> {
    const UNIX_SOCKET_DIR : string = process.cwd() + "/pg_socket";
    const PG_DATA_DIR : string = "postgresql";
    const conn_params = {
      host: UNIX_SOCKET_DIR,         
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
      
      // If PG_DATA_DIR and UNIX_SOCKET_DIR both exist, assume db is setup correctly
      if(
        !(fs.existsSync(UNIX_SOCKET_DIR) && 
        fs.lstatSync(UNIX_SOCKET_DIR).isDirectory() && 
        fs.existsSync(PG_DATA_DIR) && 
        fs.lstatSync(PG_DATA_DIR).isDirectory())){
        this.logger.info("Formatting PostgreSQL instance...");
        execSync("mkdir -p " + UNIX_SOCKET_DIR);
        execSync("rm -rf " + PG_DATA_DIR);
        execSync("initdb " + PG_DATA_DIR);
      }
      exec(`pg_ctl -D "` + PG_DATA_DIR  + `" -o "-c unix_socket_directories='` + UNIX_SOCKET_DIR + `'" start`);
      // Wait for pg to be finished, cannot use execSync as will never return as child process never exits
      // while(execSync(`pg_ctl -D "` + PG_DATA_DIR + `" -o "-c unix_socket_directories='` + UNIX_SOCKET_DIR + `'" status`).toString() === "pg_ctl: no server running")
      // {
      //   this.logger.info("waiting");
      // }
      for(let i = 0; i < 100; i++) {
        try{
          await this.delay(10);
          client = new Client(conn_params);
          await client.connect();
          break;
        } catch(err) {
          this.logger.verbose("Waiting for PostgreSQL to start... " + JSON.stringify(err));
        }
        if(i == 99){
          const err_msg = "PostgreSQL did not start within 10s";
          this.logger.error(err_msg);
          throw new Error(err_msg);
        }
      }
      // client = new Client(conn_params);
      // await client.connect();
    }

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
