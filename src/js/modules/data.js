var Dexie = require('dexie');

var db;
// Initialize database with IndexedDB and populate with n entries.
exports.init = function(n) {
  console.log("Data#init");
  return new Promise(function (resolve, reject) {
    var req = window.indexedDB.open("database", 1);
    req.onupgradeneeded = function (e) {
      console.log("Initializing database.");
      var db = e.target.result;
      db.createObjectStore("store1", {
        autoIncrement: true
      });
    };

    req.onerror = function (e) {
      console.error("Error opening database.");
    };

    req.onsuccess = function (e) {
      console.log("Database opened.");
      db = e.target.result;
      populate();
    };

    // Get sample data and add multiple entries.
    function populate() {
      var url = chrome.extension.getURL("resources/replay.json");
      var req = new XMLHttpRequest();
      req.addEventListener("load", function () {
        var s = req.responseText;
        var store = db.transaction(["store1"], "readwrite").objectStore("store1");
        var i = 0;
        var dbreq = store.add(s, i);

        function error(e) {
          console.error("Error adding: %o.", e);
          reject(e);
        }

        dbreq.onsuccess = function loop() {
          console.log("Added %d.", i);
          i++;
          if (i < n) {
            var req = store.add(s, i);
            req.onsuccess = loop;
            req.onerror = error;
          } else {
            resolve(db);
          }
        };
        dbreq.onerror = error;
      });
      req.open("GET", url);
      req.send();
    }
  });
};

exports.close = function () {
  return new Promise(function (resolve, reject) {
    db.onclose = function() {
      resolve();
    };
    db.close();
  });
};

// Initialize new db instance using dexie and attempt upgrade.
exports.upgradeDexie = function () {
  var db = new Dexie("database");

  // Initial versions of the database may be either 1 or 2 with
  // a 'positions' object store and an empty 'savedMovies' object
  // store.
  db.version(0.1).stores({
    store1: ''
  });

  // Current version.
  db.version(2).stores({
    store2: '++id',
    store1: null
  }).upgrade(function (trans) {
    console.log("Executing Dexie upgrade.");
    trans.on('complete', function () {
      console.log("Transaction completed.");
    });

    trans.on('abort', function () {
      console.warn("inside transaction abort handler");
    });

    trans.on('error', function () {
      console.warn("Inside transaction error handler.");
    });

    trans.store1.count().then(function (total) {
      var done = 0;
      trans.store1.each(function (item, cursor) {
        var data = {
          data: JSON.parse(item)
        };
        trans.store2.add(data).then(function (id) {
          console.log("Finished data: %d.", ++done);
        }).catch(function (err) {
          // Catch replay conversion or save error.
          console.error("Couldn't save due to: %o.", e);
          trans.abort();
        });
      });
    });
  });

  return db.open();
};

exports.upgradeNative = function () {

};

exports.delete = function () {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.deleteDatabase("database");
    req.onerror = function(e) {
      console.error("Error deleting database.");
      reject();
    };
    req.onsuccess = function(e) {
      console.log("Database deleted successfully.");
      resolve();
    };
  });
};


// Reset the database, for debugging.
exports.resetDatabase = function() {
  db.delete();
};
