'use strict';

var AWS = require('aws-sdk');
var _ = require('lodash-fp');
var queryString = require('query-string');

var dynamoDb = new AWS.DynamoDB.DocumentClient({
  region: 'localhost',
  endpoint: 'http://localhost:8000'
});

module.exports.lookup = (event, context, callback) => {
  var params = {
    TableName: 'printJobsTable',
    FilterExpression: 'jobStatus = :statusKey',
    ExpressionAttributeValues: { ':statusKey': 'Active' }
  };

  dynamoDb.scan(params, function (err, data) {
    const dataItems = data.Items;
    const ids = _.map((item) => item.jobId)(dataItems)
    const items = _.map((item) => item.data)(dataItems);

    callback(null, response(200, {
      pass: true,
      version: 5,
      ids: ids,
      data: items
    }));
  });
};

module.exports.submit = (event, context, callback) => {
  dynamoDb.get({
    TableName: 'nextJobIdTable',
    Key: {
      id: 1
    }
  }, function (err, data) {
    console.log(data);
    let nextId = data.Item ? data.Item.nextId : 1;
    // Updates or adds.
    dynamoDb.update({
      TableName: 'nextJobIdTable',
      Key: { id: 1 },
      UpdateExpression: 'set #a = :x',
      ExpressionAttributeNames: { '#a': 'nextId' },
      ExpressionAttributeValues: {
        ':x': nextId + 1
      }
    }, function () {
      submitJob(event, context, callback, nextId);
    });
  });
}

module.exports.update = (event, context, callback) => {

  // Update POST data from PrintOS local server.
  const updateData = queryString.parse(event.body);
  console.log(updateData);

  const printJobId = parseInt(updateData.id, 10);
  const jobStatus = updateData.status;

  console.log(printJobId, jobStatus);

  dynamoDb.update({
    TableName: 'printJobsTable',
    Key: { jobId: printJobId },
    UpdateExpression: 'set #a = :x',
    ExpressionAttributeNames: { '#a': 'jobStatus' },
    ExpressionAttributeValues: {
      ':x': jobStatus
    }
  }, function (err, data) {
    // The pass true response is expected by PrintOS local server.
    callback(null, response(200, { pass: true }))
  });
}

///

function submitJob(event, context, callback, nextJobId) {
  const jobData = JSON.parse(event.body);
  const accessKey = jobData.accessKey;
  const destination = jobData.destination;
  const data = jobData.data;
  const dbParams = {
    TableName: 'printJobsTable',
    Item: {
      jobId: nextJobId,
      jobStatus: 'Active',
      data: data,
      destination: destination
    }
  };

  if (!accessKey || !destination || !data) {
    callback(null, response(400, {
      message: 'Requires Access Key and Destination and Data.'
    }));
  }
  else {
    dynamoDb.put(dbParams, function (err, data) {
      if (err) {
        callback(null, response(500, {
          message: 'Internal error when creating print job.',
          error: err.message
        }));
      }
      else {
        callback(null, response(200, {
          message: 'Print job submitted successfully.'
        }));
      }
    });
  }
}

function response(statusCode, data) {
  return {
    statusCode: statusCode,
    body: JSON.stringify(data),
  };
}
