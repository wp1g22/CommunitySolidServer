import { Credentials } from '../authentication/Credentials';
import { CredentialsExtractor } from '../authentication/CredentialsExtractor';
import { getLoggerFor } from '../logging/LogUtil';
import { HttpHandler, HttpHandlerInput } from '../server/HttpHandler';
import { BadRequestHttpError } from '../util/errors/BadRequestHttpError';
import { NotImplementedHttpError } from '../util/errors/NotImplementedHttpError';
import { Client } from 'pg'; 


export interface SearchHandlerArgs {
  /**
   * Extracts the credentials from the incoming request.
   */
  credentialsExtractor: CredentialsExtractor;
}

export class SearchHandler extends HttpHandler {
  private readonly logger = getLoggerFor(this);
  

  private readonly credentialsExtractor: CredentialsExtractor;
  
  public constructor(args: SearchHandlerArgs) {
    super();
    this.credentialsExtractor = args.credentialsExtractor;
  }

  public async handle({ request, response }: HttpHandlerInput): Promise<void> {
      this.logger.info("SearchHandler: Handle");
      try {
        const credentials: Credentials = await this.credentialsExtractor.handleSafe(request);
        this.logger.info("Credentials: " + JSON.stringify(credentials));
        const webId : String = credentials.agent?.webId || "public";
        this.logger.info("WebID: " + webId);
        const results = await this.connectAndSearch(webId, request.headers.search_phrase as string);
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ message: "Successfully searched!", results }));
      } catch (error : unknown) {
        if(error instanceof BadRequestHttpError){
          // 401 is code for unauthorized, indicating an error with SOLID-IODC authentication
          response
          .writeHead(401, { "Content-Type": "application/json" })
          .end(JSON.stringify(error));
        } else {
          // 500 indicates an internal server error, possibly an error with PostgreSQL
          this.logger.error(JSON.stringify(error));
          response
            .writeHead(500, { "Content-Type": "application/json" })
            .end(JSON.stringify(error));
        }
      }
      
  }
    
  public async canHandle({ request }: HttpHandlerInput): Promise<void> {
    this.logger.info("SearchHandler: CanHandle");
    this.logger.info("Headers: " + JSON.stringify(request.headers));
    this.logger.info("Method: " + request.method);
    if(request.method === "GET" && request.headers.search_phrase) {
      this.logger.info("Valid Search of phrase: " + request.headers.search_phrase);
    } else {
      this.logger.info("Not a search request");
      throw new NotImplementedHttpError('Not a search request');
    }
  }

  /**
   * Searches all pod text documents using PostgreSQL
   * @param user authenticated webId of the user who issearching
   * @param queryString string of the search query
   * @returns List of the urls of the resources which the users has access to and are relevant to the search query
   */
  private async connectAndSearch(user: String, queryString : String) : Promise<String[]>{
    this.logger.info("Connect and Search");
    const results : String[] = [];
    // const client = new Client({
    //   host: 'localhost',         
    //   port: 5432,               
    //   user: 'test_user', 
    //   password: 'Password1@',        
    //   database: 'documents', 
    // });
    const client = new Client({
      host: process.cwd() + "/pg_socket",         
      port: 5432,       
      database: 'documents'
    });
    this.logger.info("Connecting...");
    await client.connect();
    this.logger.info('Connected to PostgreSQL database!');

    await client.query("SET app.user_id = '" + user + "'");

    const query = `
      SELECT solid_url, document_text
      FROM documents
      WHERE searchable_tsvector @@ to_tsquery('english', $1);
    `;

    const res = await client.query(query, [queryString]);
    this.logger.info("Parsing query results");
    if (res.rows.length > 0) {
      this.logger.info('Search Results:');
      res.rows.forEach((row) => {
        this.logger.info(`Document URL: ${row.solid_url}, Text: ${row.document_text}`);
        results.push(row.solid_url);
      });
    } else {
      this.logger.info('No documents found matching the search.');
    }
    await client.query("SET app.user_id = 'public'");
    await client.end();

    return results;

  }
}

