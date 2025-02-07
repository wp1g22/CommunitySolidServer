import { NotImplementedError } from '@inrupt/solid-client-authn-core';
import { getLoggerFor } from '../logging/LogUtil';
import { Initializer } from './Initializer';
import { Client, ClientConfig } from 'pg'; 
import { exec, execSync } from 'child_process';
import * as fs from 'fs';


/**
 * Purpose of this initializer is to ensure PostgreSQL is running alongside the server.
 * If PostgreSQL is not already running, it will attempt to start running it.
 * If the database cannot be found it will attempt to create a new database with the appropriate schema and indicies for Full Text Search.
 */
export class PostgreSQLInitializer extends Initializer  {
  protected readonly logger = getLoggerFor(this);
  private readonly DB_NAME : string= "documents";
  private readonly DOCUMENTS_TABLE_NAME : string= "documents";
  private readonly ACL_TABLE_NAME : string = "document_access";
  private readonly UNIX_SOCKET_DIR : string = process.cwd() + "/pg_socket";
  private readonly PG_DATA_DIR : string = "postgresql";

  public async canHandle(): Promise<void> {
    // throw new NotImplementedError("No PostgreSQL demon running");
  }

  public async handle(): Promise<void> {
    const conn_params : ClientConfig = {
      host: this.UNIX_SOCKET_DIR,         
      port: 5432,               
      database: 'postgres' 
    };
    
    var client = new Client(conn_params);
    this.logger.info("Connecting to PostgreSQL...");
    try {
      await client.connect();
    } catch(err) {
      this.logger.info("Unable to connect to PostgreSQL, attemping to start...");
      await this.startPostgreSQL(conn_params); 
    }
    client = new Client(conn_params);
    client.connect();

    this.logger.info("Connected to PostgreSQL!");



    // Check if DB_NAME database already exists in this PostgreSQL instance, if it is, assume it is configured correctly
    const dbCheck = await client.query("SELECT 1 FROM pg_database WHERE datname = '" + this.DB_NAME + "'");
    if (dbCheck.rowCount === 0) {
      this.logger.info("Database '" + this.DB_NAME + "' not found. Creating...");
      await client.query('CREATE DATABASE ' + this.DB_NAME);
      await client.end();
      this.logger.info("Database created, now configuring.");
      await this.configureDatabase(conn_params);
      this.logger.info("Database '" + this.DB_NAME + "' configured.");
    } else {
      this.logger.info("Database '" + this.DB_NAME + "' already exists.");
    }
    
  }

  /**
   * Assuming that PostgreSQL is not already started, this will attempt to start PostgreSQL.
   * Using the shell of the system being run on. 
   * @param conn_params Parameters pre-assigned to connect to PostgreSQL
   */
   private async startPostgreSQL(conn_params : ClientConfig) {
    // If PG_DATA_DIR and UNIX_SOCKET_DIR both exist, assume db is setup correctly
    if(
      !(fs.existsSync(this.UNIX_SOCKET_DIR) && 
      fs.lstatSync(this.UNIX_SOCKET_DIR).isDirectory() && 
      fs.existsSync(this.PG_DATA_DIR) && 
      fs.lstatSync(this.PG_DATA_DIR).isDirectory())){
      this.logger.info("Formatting PostgreSQL instance...");
      execSync("mkdir -p " + this.UNIX_SOCKET_DIR);
      execSync("rm -rf " + this.PG_DATA_DIR);
      execSync("initdb " + this.PG_DATA_DIR);
    }
    exec(`pg_ctl -D "` + this.PG_DATA_DIR  + `" -o "-c unix_socket_directories='` + this.UNIX_SOCKET_DIR + `'" start`);
    // Wait for up to 10s for pg to be started, cannot use execSync as will never return as child process never exits
    for(let i = 0; i < 100; i++) {
      try{
        await this.delay(10);
        const  client = new Client(conn_params);
        await client.connect();
        await client.end();
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
  }

  /**
   * Assuming the Database already exists, this will create the needed tables, indices and policies
   * to support Full Text Search whilst respecting access control.
   * @param conn_params Parameters pre-assigned to connect to PostgreSQL
   */
  private async configureDatabase(conn_params : ClientConfig) {
    
    conn_params.database = this.DB_NAME;
    const client = new Client(conn_params);

    this.logger.info("Connecting to '" + this.DB_NAME + "' db...");
    await client.connect();
    this.logger.info("Connected to '" + this.DB_NAME + "' db!");
    await client.query(
      `CREATE TABLE ` + this.DOCUMENTS_TABLE_NAME + `(
        solid_url text NOT NULL PRIMARY KEY,
        document_text text NOT NULL,
        searchable_tsvector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, document_text)) STORED
    )`);

    await client.query(
      `CREATE TABLE ` + this.ACL_TABLE_NAME + ` (
        user_id text NOT NULL,
        solid_url text NOT NULL REFERENCES ` + this.DOCUMENTS_TABLE_NAME + `(solid_url) ON DELETE CASCADE,
        PRIMARY KEY (user_id, solid_url)
    )`);

    await client.query(
      `CREATE POLICY user_access_policy ON ` + this.DOCUMENTS_TABLE_NAME + ` USING ((EXISTS ( SELECT 1
          FROM ` + this.ACL_TABLE_NAME + `
          WHERE ((` + this.ACL_TABLE_NAME + `.solid_url = ` + this.DOCUMENTS_TABLE_NAME + `.solid_url) AND (` + this.ACL_TABLE_NAME + `.user_id = current_setting('app.user_id'::text))))))
        `
    );

    await client.query(`ALTER TABLE ` + this.DOCUMENTS_TABLE_NAME + ` ENABLE ROW LEVEL SECURITY`);

    await client.query(`ALTER TABLE ONLY ` + this.DOCUMENTS_TABLE_NAME + ` FORCE ROW LEVEL SECURITY`);

    await client.query(`CREATE INDEX document_access_idx ON ` + this.ACL_TABLE_NAME + ` USING btree (user_id, solid_url)`);

    await client.query(`CREATE INDEX documents_search_idx ON ` + this.DOCUMENTS_TABLE_NAME + ` USING gin (searchable_tsvector)`);

    await client.end();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
