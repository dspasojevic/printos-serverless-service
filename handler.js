'use strict';

const AWS = require('aws-sdk');
const _ = require('lodash-fp');
const queryString = require('query-string');
const urlencode = require('urlencode');

AWS.config.update({ region: 'ap-southeast-2' });

// {
//   region: 'localhost',
//   endpoint: 'http://localhost:8000'
// }
const dynamoDb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });

const printJobsTableName = process.env.PRINT_JOBS_TABLE_NAME;
const nextJobIdTableName = process.env.NEXT_JOB_ID_TABLE_NAME;
const clientsTableName = process.env.CLIENT_TABLE_NAME;

// PrintOS lookup response expected by PrintOS local server.
const printOSLookupResponse = (pass, ids, items) => ({
  pass: pass,
  version: 5.1,
  ids: ids,
  data: items
});

// PrintOS print job update response expected by PrintOS local server.
const printOSUpdateResponse = (pass, message) => ({
  pass: pass,
  message: message
});

// PrintPOS print job status response expected by legacy client.
const printOSStatusResponse = (pass, printJobStatues) => ({
  pass: pass,
  status: printJobStatues
});

const printJobStatus = {
  Active: 'Active'
};

/// modules.

module.exports.lookup = (event, context, callback) => {
  const lookupData = queryString.parse(event.body);
  const destination = lookupData.username;
  const password = lookupData.password;

  authenticate(destination, password, lookingUp, callback);

  function lookingUp(err, data) {
    dbQuery(printJobsTableName, 'jobStatus = :statusKey and destination = :destinationKey',
      { ':statusKey': printJobStatus.Active, ':destinationKey': destination }, printJobsResponse, 'destination_status_index');
  }

  function printJobsResponse(err, data) {
    if (data) {
      const dataItems = data.Items;
      const ids = _.map((item) => item.jobId)(dataItems)

      // Server side uses Java URLEncoder to encode the data string,
      // which converts space to '+' sign, replace + to % 20, so the Javascript URL encoder knows what to be decoded.
      // @see https://stackoverflow.com/a/607403
      const items = _.map((item) => {
        const converted = item.data.replaceAll(/\+/g, '%20');
        return urlencode.decode(converted);
      })(dataItems);
      callback(null, response(200, printOSLookupResponse(true, ids, items)));
    }
    else {
      callback(null, response(200, printOSLookupResponse(true, [], [])));
    }
  }
};

module.exports.submit = (event, context, callback) => {
  const jobData = queryString.parse(event.body);
  const password = jobData.password;
  const destination = jobData.destination;

  authenticate(destination, password, function () {
    nextJobId().then((nextJobId) => {
      submitJob(event, context, callback, nextJobId, destination);
    });
  }, callback);
}

module.exports.update = (event, context, callback) => {
  // Update POST data from PrintOS local server.
  const updateData = queryString.parse(event.body);
  const printJobId = parseInt(updateData.id, 10);
  const jobStatus = updateData.status;
  const password = updateData.password;
  const destination = updateData.username;

  authenticate(destination, password, updatingJob, callback);

  function updatingJob() {
    dynamoDb.update({
      TableName: printJobsTableName,
      Key: { jobId: printJobId },
      UpdateExpression: 'set #a = :x',
      ExpressionAttributeNames: { '#a': 'jobStatus' },
      ExpressionAttributeValues: {
        ':x': jobStatus
      }
    }, function (err, data) {
      if (err) {
        callback(null, response(200, printOSUpdateResponse(false, err.message)));
      }
      else {
        callback(null, response(200, printOSUpdateResponse(true)));
      }
    });
  }
}

module.exports.printJob = (event, context, callback) => {
  try {
    const jobId = parseInt(event.queryStringParameters.jobId, 10);
    const destination = event.queryStringParameters.destination;
    const password = event.queryStringParameters.password;
    authenticate(destination, password, function () {
      dbQuery(printJobsTableName, 'destination = :destinationKey and jobId = :jobIdKey', { ':jobIdKey': jobId, ':destinationKey': destination }, function (err, data) {
        callback(null, response(200, { printJobs: data.Items }));
      });
    }, callback);
  }
  catch (e) {
    console.log(e.message);
    callback(null, response(400, { message: 'Invalid query parameter.' }));
  }
}

module.exports.jobStatus = (event, context, callback) => {
  try {
    // Status query from DataPOS server, requires destination as username.
    const statusData = queryString.parse(event.body);
    const destination = statusData.destination;
    const password = statusData.password;
    const startId = parseInt(statusData.startid, 10);

    authenticate(destination, password, function () {
      dbQuery(printJobsTableName, 'destination = :destinationKey and jobId = :jobIdKey', { ':jobIdKey': startId, ':destinationKey': destination }, function (err, data) {
        console.log(data);
        if (data) {
          callback(null, response(200, printOSStatusResponse(true, _.map((job) => ({
            id: job.jobId,
            status: job.jobStatus
          }))(data.Items))));
        }
        else {
          callback(null, response(200, printOSStatusResponse(true, [])));
        }
      });
    }, callback);
  }
  catch (e) {
    console.log(e.message);
    callback(null, response(400, { message: 'Invalid query parameter.' }));
  }

};

/// local functoins.

function nextJobId() {
  return new Promise((resolve, reject) => dynamoDb.get({
    TableName: nextJobIdTableName,
    Key: {
      id: 1
    }
  }, function (err, data) {
    let nextId = data && data.Item ? data.Item.nextId : 1;
    if (err) {
      reject(err);
    }
    // Updates or adds.
    dynamoDb.update({
      TableName: nextJobIdTableName,
      Key: { id: 1 },
      UpdateExpression: 'set #a = :x',
      ExpressionAttributeNames: { '#a': 'nextId' },
      ExpressionAttributeValues: {
        ':x': nextId + 1
      }
    }, function (err, data) {
      if (err) {
        reject(err);
      }
      else {
        resolve(nextId);
      }
    });
  }));
}

function submitJob(event, context, callback, nextJobId, destination) {
  const jobData = queryString.parse(event.body);
  const data = jobData.data;
  const dbParams = {
    TableName: printJobsTableName,
    Item: {
      jobId: nextJobId,
      jobStatus: printJobStatus.Active,
      data: data,
      destination: destination,
      timeSubmitted: new Date().valueOf()
    }
  };
  dynamoDb.put(dbParams, function (err, data) {
    if (err) {
      callback(null, response(500, {
        message: 'Internal error when creating print job.',
        errorMessage: err.message,
        pass: false
      }));
    }
    else {
      callback(null, response(200, {
        id: nextJobId,
        pass: true
      }));
    }
  });
}

function dbScan(tableName, filterExpression, expressionAttributeValues, cb) {
  dynamoDb.scan({
    TableName: tableName,
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues
  }, cb)
}


function dbQuery(tableName, keyConditionExpression, expressionAttributeValues, cb, indexName) {

  let params = {
    TableName: tableName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues
  };

  if (indexName) {
    params.IndexName = indexName;
  }

  dynamoDb.query(params, cb)
}

function response(statusCode, data) {
  return {
    statusCode: statusCode,
    body: JSON.stringify(data),
  };
}

function authenticate(destination, password, successCb, callback) {
  if (!destination || !password) {
    callback(null, response(400, { message: 'Invalid password or destination. [' + destination + ']' + '[' + password + ']' }));
  }
  else {
    dbScan(clientsTableName, 'password = :passwordKey and destination = :destinationKey', { ':passwordKey': password, ':destinationKey': destination }, function (err, data) {
      if (err) {
        console.log(err);
      }
      // Desitnation and password is validated.
      if (data && data.Items && data.Items.length > 0) {
        successCb();
      }
      else {
        callback(null, response(400, { message: 'Invalid password or destination. [' + destination + ']' + '[' + password + ']' }));
      }
    });
  }
}

// @see https://stackoverflow.com/a/17606289
String.prototype.replaceAll = function (search, replacement) {
  var target = this;
  return target.split(search).join(replacement);
};