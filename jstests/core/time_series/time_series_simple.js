/**
 * Tests inserting sample data into the time-series buckets collection.
 * This test is for the simple case of only one measurement per bucket.
 * @tags: [
 *     does_not_support_stepdowns,
 *     requires_fcv_49,
 * ]
 */
(function() {
"use strict";

load("jstests/core/time_series/libs/time_series.js");

if (!TimeseriesTest.timeseriesCollectionsEnabled(db.getMongo())) {
    jsTestLog("Skipping test because the time-series collection feature flag is disabled");
    return;
}

const testDB = db.getSiblingDB(jsTestName());
assert.commandWorked(testDB.dropDatabase());

const coll = testDB.getCollection('t');
const bucketsColl = testDB.getCollection('system.buckets.' + coll.getName());

coll.drop();

const timeFieldName = 'time';
assert.commandWorked(
    testDB.createCollection(coll.getName(), {timeseries: {timeField: timeFieldName}}));
assert.contains(bucketsColl.getName(), testDB.getCollectionNames());

Random.setRandomSeed();
const numHosts = 10;
const hosts = TimeseriesTest.generateHosts(numHosts);

/**
 * Updates min and max values in expected control document in bucket with most recent measurement.
 * Use bsonWoCompare() to handle non-numerical values (such as ObjectId() for _id).
 */
function updateControlDoc(controlDoc, key, newVal) {
    if (!controlDoc.min.hasOwnProperty(key)) {
        controlDoc.min[key] = newVal;
    } else if (bsonWoCompare(newVal, controlDoc.min[key]) < 0) {
        controlDoc.min[key] = newVal;
    }
    if (!controlDoc.max.hasOwnProperty(key)) {
        controlDoc.max[key] = newVal;
    } else if (bsonWoCompare(newVal, controlDoc.max[key]) > 0) {
        controlDoc.max[key] = newVal;
    }
}

const controlVersion = 1;
const numDocs = 100;
const expectedBucketDoc = {
    control: {
        version: controlVersion,
        min: {},
        max: {},
    },
    // no 'meta' field defined.
    data: {},
};

for (let i = 0; i < numDocs; i++) {
    const host = TimeseriesTest.getRandomElem(hosts);
    TimeseriesTest.updateUsages(host.fields);

    // Ignore host.tags because we did not provide 'metaField' during collection creation.
    const t = ISODate();
    const doc = Object.assign({_id: i, [timeFieldName]: t}, host.fields);

    jsTestLog('Inserting doc into time-series collection: ' + i + ': ' + tojson(doc));
    let start = new Date();
    assert.commandWorked(coll.insert(doc));
    jsTestLog('Insertion took ' + ((new Date()).getTime() - start.getTime()) +
              ' ms. Retrieving doc from view: ' + i);
    start = new Date();
    const docFromView = coll.findOne({_id: doc._id});
    assert(docFromView, 'inserted doc missing from time-series view: ' + i + ': ' + tojson(doc));
    jsTestLog('Doc retrieval took ' + ((new Date()).getTime() - start.getTime()) +
              ' ms. Doc fetched from view: ' + i + ': ' + tojson(docFromView));
    assert.docEq(doc, docFromView, 'Invalid document retrieved from view: ' + i);

    // Update expected control min/max and data in bucket.
    Object.keys(doc).forEach((key) => {
        updateControlDoc(expectedBucketDoc.control, key, doc[key]);
    });
    Object.keys(doc).forEach((key) => {
        if (!expectedBucketDoc.data.hasOwnProperty(key)) {
            expectedBucketDoc.data[key] = {};
        }
        expectedBucketDoc.data[key][i] = doc[key];
    });
}

// Check view.
const viewDocs = coll.find().toArray();
assert.eq(numDocs, viewDocs.length, viewDocs);

// Check bucket collection.
const bucketDocs = bucketsColl.find().toArray();
assert.eq(1, bucketDocs.length, bucketDocs);
const bucketDoc = bucketDocs[0];
jsTestLog('Bucket collection document: ' + tojson(bucketDoc));
assert.docEq(expectedBucketDoc.control.min,
             bucketDoc.control.min,
             'invalid min in bucket: ' + tojson(bucketDoc));
assert.docEq(expectedBucketDoc.control.max,
             bucketDoc.control.max,
             'invalid max in bucket: ' + tojson(bucketDoc));
Object.keys(expectedBucketDoc.data).forEach((key) => {
    assert.docEq(expectedBucketDoc.data[key],
                 bucketDoc.data[key],
                 'invalid bucket data for field ' + key + ': ' + tojson(bucketDoc));
});
})();
