# Manhattan Antennas Performance

https://user-images.githubusercontent.com/11491779/152449609-a943678f-b90d-4ff8-8294-96a2b459f6bc.mp4

If you want to try it right now, clone the project and run:

```
docker-compose up
```

After a successful build:

```
# Check in your browser
localhost:3000

# Alternatively connect to:
# Materialize
psql postgresql://materialize:materialize@localhost:6875/materialize

# Postgres
psql postgresql://postgres:pg_password@localhost:5432/postgres
```

---


## Let’s begin.

An infrastructure working safe and healthy is critical. We, developers, know this very well. In other businesses, like in software, there are vital infrastructures, such as mobile antennas (4G, 5G) in telecommunications companies. If there is some issue, you want to detect it quickly; otherwise, your customers will complain, or even worse, move to the competition (churn rate is serious business).

Antennas builders share [key performance indicators](https://www.ericsson.com/en/reports-and-papers/white-papers/performance-verification-for-5g-nr-deployments) with their telecommunications customers. Let's call all these indicators a simple value defined as "performance". Rather than setting a 5G antenna manually, randomness will generate this value, providing even more excitement and entertainment to the case than in real life.

Each antenna has a fixed range that serves multiple clients using their signal denoted as a circle in a map with a defined radius of green, yellow, or red (healthy, semi-healthy, and unhealthy).

If the last-minute average performance is greater than 5, the antenna is healthy. <br/>
If it is greater than 4.75 but less than 5, it is semi-healthy. <br/>
If it is less than 4.75, the antenna is unhealthy. <br/>

All this information needs to be processed and served by someone, and that's when Materialize will do the majority of the work efficiently.

## Detailes steps

There are different ways to achieve a result like this one using Materialize, but for this case, the following strategy has been implemented:

1.  Postgres, where all the base data resides.
2.  Materialize to process and serve the antennas performance.
3.  Helper process to generate the antennas random data and initialize Materialize
4.  Node.js GraphQL API connecting to Materialize using [tails](https://materialize.com/docs/sql/tail/#conceptual-framework).
5.  React front-end displaying the information using GraphQL subscriptions.

_Our source, Postgres, could be alternatively replaced with any other [Materialize source](https://materialize.com/docs/sql/create-source/#conceptual-framework)_

![Architecture](https://user-images.githubusercontent.com/11491779/152603370-cef44fda-587b-46e9-bf67-d0b785ebee8f.png)

<br/>

1. To begin with, Postgres needs to be up and running. Since we are using docker, you can reuse the [custom image with SQLs and shell scripts](https://github.com/MaterializeInc/developer-experience/tree/main/mz-playground/postgres-graphql/postgres) that will get executed in the Postgres initialization. [entrypoint folder](https://github.com/docker-library/docs/blob/master/postgres/README.md#initialization-scripts). <br/><br/> The scripts basically creates the schemas and defines everything we need to use them as a source:


```sql
-- Antennas table will contain the identifier and geojson for each antenna.
CREATE TABLE antennas (
    antenna_id INT GENERATED ALWAYS AS IDENTITY,
    geojson JSON NOT NULL
);


-- Antennas performance table will contain every performance update available
CREATE TABLE antennas_performance (
    antenna_id INT,
    clients_connected INT NOT NULL,
    performance INT NOT NULL,
    updated_at timestamp NOT NULL
);


-- Enable REPLICA for both tables
ALTER TABLE antennas REPLICA IDENTITY FULL;
ALTER TABLE antennas_performance REPLICA IDENTITY FULL;


-- Create publication on the created tables 
CREATE PUBLICATION antennas_publication_source FOR TABLE antennas, antennas_performance;


-- Create user and role to be used by Materialize
CREATE ROLE materialize REPLICATION LOGIN PASSWORD 'materialize';
GRANT SELECT ON antennas, antennas_performance TO materialize;
```
<br/>

2-3. Once Postgres is up and running, Materialize will be ready to consume it. If you are automating a deployment a [helper process](https://github.com/MaterializeInc/developer-experience/blob/main/mz-playground/postgres-graphql/helper/src/app.ts) can do the job to set up sources and views in Materialize and also feed indefinitely Postgres with data.<br/><br/> The SQL script to build Materialize schema is the next one:

```sql
  -- All these queries run inside the helper process.
  
  
  -- Create the Postgres Source
  CREATE MATERIALIZED SOURCE IF NOT EXISTS antennas_publication_source
  FROM POSTGRES
  CONNECTION 'host=postgres port=5432 user=materialize password=materialize dbname=postgres'
  PUBLICATION 'antennas_publication_source';


  -- Turn the Postgres tables into Materialized Views
  CREATE MATERIALIZED VIEWS FROM SOURCE antennas_publication_source;
  
  
  -- Filter last minute updates
  CREATE MATERIALIZED VIEW IF NOT EXISTS last_minute_updates AS
  SELECT A.antenna_id, A.geojson, performance, AP.updated_at, ((CAST(EXTRACT( epoch from AP.updated_at) AS NUMERIC) * 1000) + 60000)
  FROM antennas A JOIN antennas_performance AP ON (A.antenna_id = AP.antenna_id)
  WHERE ((CAST(EXTRACT( epoch from AP.updated_at) AS NUMERIC) * 1000) + 60000) > mz_logical_timestamp();


  -- Aggregate by anntena ID and GeoJSON to obtain the average performance in the last minute.  
  CREATE MATERIALIZED VIEW IF NOT EXISTS last_minute_performance_per_antenna AS
  SELECT antenna_id, geojson, AVG(performance) as performance
  FROM last_minute_updates
  GROUP BY antenna_id, geojson;
```

Antennas data generation statement:

```sql
  -- Insert data using the helper process.
  INSERT INTO antennas_performance (antenna_id, clients_connected, performance, updated_at) VALUES (
    ${antennaId},
    ${Math.ceil(Math.random() * 100)},
    ${Math.random() * 10},
    now()
  );
```


4. Now, our information should be ready to consume. <br/><br/>
The back-end will be based on [Graphql-ws](https://github.com/enisdenjo/graphql-ws). Subscriptions and tails go together like Bonnie and Clyde. Applications sending constant events to the front-end are usually implemented with sockets or server-sent events (SSE), and they become super handy to use with `tails`. So, rather than constantly send queries back-and-forth, we can run a `tail with (snapshot)` and get the same results. <br/><br/>
The back-end will use a modified client to run these tails. It implements internally [Node.js stream interfaces](https://nodejs.org/api/stream.html) to handle [backpressure](https://github.com/MaterializeInc/developer-experience/blob/main/mz-playground/postgres-graphql/backend/src/MaterializeClient/TailStream/index.ts), [create one second batches and group all the changes in one map (summary)](https://github.com/MaterializeInc/developer-experience/blob/main/mz-playground/postgres-graphql/backend/src/MaterializeClient/TransformStream/index.ts).


5. We will not get so deep here for our React front-end, but it will consist of only one component. Using Apollo GraphQL, subscribe to our back-end and display the antennas information in a list and a visual map. The frequency at which the information updates is every one second.