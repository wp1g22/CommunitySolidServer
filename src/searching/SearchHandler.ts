import { getLoggerFor } from '../logging/LogUtil';
import { HttpHandler, HttpHandlerInput } from '../server/HttpHandler';
import { NotImplementedHttpError } from '../util/errors/NotImplementedHttpError';
import { Client } from 'pg'; 


export class SearchHandler extends HttpHandler {
    private readonly logger = getLoggerFor(this);
  

  public async handle({ request, response }: HttpHandlerInput): Promise<void> {
      this.logger.info("SearchHandler: Handle");
      const results = await this.connectAndSearch("user1", request.headers.search_phrase as string);
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ message: "Successfully searched!", results }));
      
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

  private async connectAndSearch(user: String, queryString : String) : Promise<String[]>{
    this.logger.info("Connect and Search");
    const results : String[] = [];
    const client = new Client({
      host: 'localhost',         
      port: 5432,               
      user: 'test_user', 
      password: 'Password1@',        
      database: 'documents', 
    });
    try {
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
    } catch (err) {
      this.logger.error('Error executing query' +  err);
    } finally {
      await client.end();
      this.logger.info('Connection closed.');
    }
    return results;

  }
}

