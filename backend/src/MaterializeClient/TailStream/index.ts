import { Readable } from "stream";
import { Client } from "pg";

/**
 * Thanks to Petros Angelatos
 * https://gist.github.com/petrosagg/804e5f009dee1cb8af688654ba396258
 * This class reads from a cursor in PostgreSQL
 */
export default class TailStream extends Readable {
  client: Client;

  cursorId: string;

  pendingReads: number;

  currentRows: Array<any>;

  constructor(client: Client, cursorId: string) {
    super({
      highWaterMark: 1000,
      objectMode: true,
    });
    this.client = client;
    this.cursorId = cursorId;
    this.pendingReads = 0;
  }

  _read(n: number): void {
    if (this.pendingReads === 0) {
      this.client
        .query(`FETCH ${n} ${this.cursorId} WITH (TIMEOUT='1s');`)
        .then((fetchResult) => {
          const { rows } = fetchResult;
          this.pendingReads = rows.length;
          this.currentRows = rows;
          rows.forEach((row) => {
            this.pendingReads -= 1;
            const backPressure = this.push(row);
            if (backPressure) {
              return;
            }
          });
        })
        .catch((queryErr) => {
          console.error("Error querying this cursor.");
          console.error(queryErr);
          this.destroy(queryErr);
        });
    } else {
      this.currentRows = this.currentRows.slice(
        this.currentRows.length - this.pendingReads,
        this.currentRows.length
      );
      this.currentRows.forEach((row) => {
        this.pendingReads -= 1;
        const backPressure = this.push(row);
        if (backPressure) {
          return;
        }
      });
    }
  }
}
