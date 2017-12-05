# Serverless PrintOS Service 

This is serverless implementation of PrintOS server: http://printos.io

This project uses Serverless Framework: https://github.com/serverless/serverless

Local development


Install Serverless Framework:
```
npm install -g serverless
```

Install packages: 
```
npm install
```

Start API Gateway locally (https://github.com/dherault/serverless-offline):
```
sls offline start
```

Start DynamoDB locally (https://github.com/99xt/serverless-dynamodb-local):
```
sls dynamodb start --migrate
OR (if you already created the tables)
sls dynamodb start
```

After it is running locally, APIs:
```
// Lookup Active print jobs for a destination.
POST http://localhost:3000/lookup
// Request JSON Body
{
  username: 'destination',
  password: '1234'
}
```
```
// Submit print job to a destination.
POST http://localhost:3000/submit
// Request JSON Body
{
  data: "{\"mode\": \"tagged\", \"comments\": \"Order E1 \"}", // refer to http://printos.io/doc/api_plaintextprintjobsubmission
  password: "1234",
  destination: "destination"
}
```
```
// Update print job from a destination.
POST http://localhost:3000/update
// Request JSON Body
{
  username: 'destination',
  password: '1234',
  status: 'Completed' // A String indicates current print job status.
}
```
```
// Get single print job by job id and its destination with password.
GET http://localhost:3000/print-jobs?jobId=10&destination=destination&password=1234
```
