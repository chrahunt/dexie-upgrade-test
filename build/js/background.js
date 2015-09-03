(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Data = require('./modules/data');

// Ensure database is not present.
Data.delete().then(function () {
  window.dexieInit = function (n) {
    Data.init(n || 100).then(function () {
      console.log("Initialized.");
      Data.close().then(function () {
        console.log("Database closed.");
      }).catch(function () {
        console.error("Database could not be closed.");
      });
      window.dexieUpgrade = function () {
        Data.upgradeDexie().then(function () {
          console.log("Finished upgrade.");
        }).catch(function (err) {
          console.error("Dexie upgrade failed: %o.", err);
        });
      };
      console.log("Ready to do upgrade. Run with `dexieUpgrade`");
    }).catch(function (err) {
      console.error("Initialization failed: %o.", err);
    });
  };
  console.log("Ready to do initialization. Run with `dexieInit(n)`");
});

},{"./modules/data":2}],2:[function(require,module,exports){
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

},{"dexie":3}],3:[function(require,module,exports){
(function (global){
/* Minimalistic IndexedDB Wrapper with Bullet Proof Transactions
   =============================================================

   By David Fahlander, david.fahlander@gmail.com

   Version 1.2 (alpha - not yet distributed) - DATE, YEAR.

   Tested successfully on Chrome, IE, Firefox and Opera.

   Official Website: https://github.com/dfahlander/Dexie.js/wiki/Dexie.js

   Licensed under the Apache License Version 2.0, January 2004, http://www.apache.org/licenses/
*/
(function (global, publish, undefined) {

    "use strict";

    function extend(obj, extension) {
        if (typeof extension !== 'object') extension = extension(); // Allow to supply a function returning the extension. Useful for simplifying private scopes.
        Object.keys(extension).forEach(function (key) {
            obj[key] = extension[key];
        });
        return obj;
    }

    function filterProperties(obj, fn) {
        var newObj = {};
        Object.keys(obj).forEach(function (key) {
            if (fn(obj[key]))
                newObj[key] = obj[key];
        });
        return newObj;
    }

    function derive(Child) {
        return {
            from: function (Parent) {
                Child.prototype = Object.create(Parent.prototype);
                Child.prototype.constructor = Child;
                return {
                    extend: function (extension) {
                        extend(Child.prototype, typeof extension !== 'object' ? extension(Parent.prototype) : extension);
                    }
                };
            }
        };
    }

    function override(origFunc, overridedFactory) {
        return overridedFactory(origFunc);
    }

    function Dexie(dbName, options) {
        /// <param name="options" type="Object" optional="true">Specify only if you wich to control which addons that should run on this instance</param>
        var addons = (options && options.addons) || Dexie.addons;
        // Resolve all external dependencies:
        var deps = Dexie.dependencies;
        var indexedDB = deps.indexedDB,
            IDBKeyRange = deps.IDBKeyRange,
            IDBTransaction = deps.IDBTransaction;

        var DOMError = deps.DOMError,
            TypeError = deps.TypeError,
            Error = deps.Error;

        var globalSchema = this._dbSchema = {};
        var versions = [];
        var dbStoreNames = [];
        var allTables = {};
        var notInTransFallbackTables = {};
        ///<var type="IDBDatabase" />
        var idbdb = null; // Instance of IDBDatabase
        var db_is_blocked = true;
        var dbOpenError = null;
        var isBeingOpened = false;
        var READONLY = "readonly", READWRITE = "readwrite";
        var db = this;
        var pausedResumeables = [];
        var autoSchema = false;
        var hasNativeGetDatabaseNames = !!getNativeGetDatabaseNamesFn();

        function init() {
            // If browser (not node.js or other), subscribe to versionchange event and reload page
            db.on("versionchange", function (ev) {
                // Default behavior for versionchange event is to close database connection.
                // Caller can override this behavior by doing db.on("versionchange", function(){ return false; });
                // Let's not block the other window from making it's delete() or open() call.
                db.close();
                db.on('error').fire(new Error("Database version changed by other database connection."));
                // In many web applications, it would be recommended to force window.reload()
                // when this event occurs. Do do that, subscribe to the versionchange event
                // and call window.location.reload(true);
            });
        }

        //
        //
        //
        // ------------------------- Versioning Framework---------------------------
        //
        //
        //

        this.version = function (versionNumber) {
            /// <param name="versionNumber" type="Number"></param>
            /// <returns type="Version"></returns>
            if (idbdb) throw new Error("Cannot add version when database is open");
            this.verno = Math.max(this.verno, versionNumber);
            var versionInstance = versions.filter(function (v) { return v._cfg.version === versionNumber; })[0];
            if (versionInstance) return versionInstance;
            versionInstance = new Version(versionNumber);
            versions.push(versionInstance);
            versions.sort(lowerVersionFirst);
            return versionInstance;
        }; 

        function Version(versionNumber) {
            this._cfg = {
                version: versionNumber,
                storesSource: null,
                dbschema: {},
                tables: {},
                contentUpgrade: null
            }; 
            this.stores({}); // Derive earlier schemas by default.
        }

        extend(Version.prototype, {
            stores: function (stores) {
                /// <summary>
                ///   Defines the schema for a particular version
                /// </summary>
                /// <param name="stores" type="Object">
                /// Example: <br/>
                ///   {users: "id++,first,last,&amp;username,*email", <br/>
                ///   passwords: "id++,&amp;username"}<br/>
                /// <br/>
                /// Syntax: {Table: "[primaryKey][++],[&amp;][*]index1,[&amp;][*]index2,..."}<br/><br/>
                /// Special characters:<br/>
                ///  "&amp;"  means unique key, <br/>
                ///  "*"  means value is multiEntry, <br/>
                ///  "++" means auto-increment and only applicable for primary key <br/>
                /// </param>
                var self = this;
                this._cfg.storesSource = this._cfg.storesSource ? extend(this._cfg.storesSource, stores) : stores;

                // Derive stores from earlier versions if they are not explicitely specified as null or a new syntax.
                var storesSpec = {};
                // Disregard deleted stores for upgrade schema.
                var upgradeStoresSpec = {};
                versions.forEach(function (version) { // 'versions' is always sorted by lowest version first.
                    if (version === self) {
                        var nonDeleteStoresSource = filterProperties(version._cfg.storesSource, function (v) {
                            return v !== null;
                        });
                        extend(upgradeStoresSpec, storesSpec);
                        extend(upgradeStoresSpec, nonDeleteStoresSource);
                    }
                    extend(storesSpec, version._cfg.storesSource);
                });


                var dbschema = (this._cfg.dbschema = {});
                this._parseStoresSpec(storesSpec, dbschema);
                var preUpgradeDbSchema = (this._cfg.preUpgradeDbSchema = {});
                this._parseStoresSpec(upgradeStoresSpec, preUpgradeDbSchema);
                // Update the latest schema to this version
                // Update API
                globalSchema = db._dbSchema = dbschema;
                removeTablesApi([allTables, db, notInTransFallbackTables]);
                setApiOnPlace([notInTransFallbackTables], tableNotInTransaction, Object.keys(dbschema), READWRITE, dbschema);
                setApiOnPlace([allTables, db, this._cfg.tables], db._transPromiseFactory, Object.keys(dbschema), READWRITE, dbschema, true);
                dbStoreNames = Object.keys(dbschema);
                return this;
            },
            upgrade: function (upgradeFunction) {
                /// <param name="upgradeFunction" optional="true">Function that performs upgrading actions.</param>
                var self = this;
                fakeAutoComplete(function () {
                    upgradeFunction(db._createTransaction(READWRITE, Object.keys(self._cfg.dbschema), self._cfg.dbschema));// BUGBUG: No code completion for prev version's tables wont appear.
                });
                this._cfg.contentUpgrade = upgradeFunction;
                return this;
            },
            _parseStoresSpec: function (stores, outSchema) {
                Object.keys(stores).forEach(function (tableName) {
                    if (stores[tableName] !== null) {
                        var instanceTemplate = {};
                        var indexes = parseIndexSyntax(stores[tableName]);
                        var primKey = indexes.shift();
                        if (primKey.multi) throw new Error("Primary key cannot be multi-valued");
                        if (primKey.keyPath) setByKeyPath(instanceTemplate, primKey.keyPath, primKey.auto ? 0 : primKey.keyPath);
                        indexes.forEach(function (idx) {
                            if (idx.auto) throw new Error("Only primary key can be marked as autoIncrement (++)");
                            if (!idx.keyPath) throw new Error("Index must have a name and cannot be an empty string");
                            setByKeyPath(instanceTemplate, idx.keyPath, idx.compound ? idx.keyPath.map(function () { return ""; }) : "");
                        });
                        outSchema[tableName] = new TableSchema(tableName, primKey, indexes, instanceTemplate);
                    }
                });
            }
        });

        function runUpgraders(oldVersion, idbtrans, reject, openReq) {
            if (oldVersion === 0) {
                //globalSchema = versions[versions.length - 1]._cfg.dbschema;
                // Create tables:
                Object.keys(globalSchema).forEach(function (tableName) {
                    createTable(idbtrans, tableName, globalSchema[tableName].primKey, globalSchema[tableName].indexes);
                });
                // Populate data
                var t = db._createTransaction(READWRITE, dbStoreNames, globalSchema);
                t.idbtrans = idbtrans;
                t.idbtrans.onerror = eventRejectHandler(reject, ["populating database"]);
                t.on('error').subscribe(reject);
                Promise.newPSD(function () {
                    Promise.PSD.trans = t;
                    try {
                        db.on("populate").fire(t);
                    } catch (err) {
                        openReq.onerror = idbtrans.onerror = function (ev) { ev.preventDefault(); };  // Prohibit AbortError fire on db.on("error") in Firefox.
                        try { idbtrans.abort(); } catch (e) { }
                        idbtrans.db.close();
                        reject(err);
                    }
                });
            } else {
                // Upgrade version to version, step-by-step from oldest to newest version.
                // Each transaction object will contain the table set that was current in that version (but also not-yet-deleted tables from its previous version)
                var queue = [];
                var oldVersionStruct = versions.filter(function (version) { return version._cfg.version === oldVersion; })[0];
                if (!oldVersionStruct) throw new Error("Dexie specification of currently installed DB version is missing");
                globalSchema = db._dbSchema = oldVersionStruct._cfg.dbschema;
                var anyContentUpgraderHasRun = false;

                var versToRun = versions.filter(function (v) { return v._cfg.version > oldVersion; });
                versToRun.forEach(function (version) {
                    /// <param name="version" type="Version"></param>
                    var oldSchema = globalSchema;
                    var newSchema = version._cfg.dbschema;
                    var updateSchema = version._cfg.preUpgradeDbSchema;
                    adjustToExistingIndexNames(oldSchema, idbtrans);
                    adjustToExistingIndexNames(newSchema, idbtrans);
                    adjustToExistingIndexNames(updateSchema, idbtrans);
                    globalSchema = db._dbSchema = newSchema;
                    {
                        var diff = getSchemaDiff(oldSchema, newSchema);
                        diff.add.forEach(function (tuple) {
                            queue.push(function (idbtrans, cb) {
                                createTable(idbtrans, tuple[0], tuple[1].primKey, tuple[1].indexes);
                                cb();
                            });
                        });
                        diff.change.forEach(function (change) {
                            if (change.recreate) {
                                throw new Error("Not yet support for changing primary key");
                            } else {
                                queue.push(function (idbtrans, cb) {
                                    var store = idbtrans.objectStore(change.name);
                                    change.add.forEach(function (idx) {
                                        addIndex(store, idx);
                                    });
                                    change.change.forEach(function (idx) {
                                        store.deleteIndex(idx.name);
                                        addIndex(store, idx);
                                    });
                                    change.del.forEach(function (idxName) {
                                        store.deleteIndex(idxName);
                                    });
                                    cb();
                                });
                            }
                        });
                        if (version._cfg.contentUpgrade) {
                            queue.push(function (idbtrans, cb) {
                                anyContentUpgraderHasRun = true;
                                var t = db._createTransaction(READWRITE, [].slice.call(idbtrans.db.objectStoreNames, 0), updateSchema);
                                t.idbtrans = idbtrans;
                                var uncompletedRequests = 0;
                                t._promise = override(t._promise, function (orig_promise) {
                                    return function (mode, fn, writeLock) {
                                        ++uncompletedRequests;
                                        function proxy(fn) {
                                            return function () {
                                                fn.apply(this, arguments);
                                                if (--uncompletedRequests === 0) cb(); // A called db operation has completed without starting a new operation. The flow is finished, now run next upgrader.
                                            }
                                        }
                                        return orig_promise.call(this, mode, function (resolve, reject, trans) {
                                            arguments[0] = proxy(resolve);
                                            arguments[1] = proxy(reject);
                                            fn.apply(this, arguments);
                                        }, writeLock);
                                    };
                                });
                                idbtrans.onerror = eventRejectHandler(reject, ["running upgrader function for version", version._cfg.version]);
                                t.on('error').subscribe(reject);
                                version._cfg.contentUpgrade(t);
                                if (uncompletedRequests === 0) cb(); // contentUpgrade() didnt call any db operations at all.
                            });
                        }
                        if (!anyContentUpgraderHasRun || !hasIEDeleteObjectStoreBug()) { // Dont delete old tables if ieBug is present and a content upgrader has run. Let tables be left in DB so far. This needs to be taken care of.
                            queue.push(function (idbtrans, cb) {
                                // Delete old tables
                                deleteRemovedTables(newSchema, idbtrans);
                                cb();
                            });
                        }
                    }
                });

                // Now, create a queue execution engine
                var runNextQueuedFunction = function () {
                    try {
                        if (queue.length)
                            queue.shift()(idbtrans, runNextQueuedFunction);
                        else
                            createMissingTables(globalSchema, idbtrans); // At last, make sure to create any missing tables. (Needed by addons that add stores to DB without specifying version)
                    } catch (err) {
                        openReq.onerror = idbtrans.onerror = function (ev) { ev.preventDefault(); };  // Prohibit AbortError fire on db.on("error") in Firefox.
                        try { idbtrans.abort(); } catch(e) {}
                        idbtrans.db.close();
                        reject(err);
                    }
                };
                runNextQueuedFunction();
            }
        }

        function getSchemaDiff(oldSchema, newSchema) {
            var diff = {
                del: [], // Array of table names
                add: [], // Array of [tableName, newDefinition]
                change: [] // Array of {name: tableName, recreate: newDefinition, del: delIndexNames, add: newIndexDefs, change: changedIndexDefs}
            };
            for (var table in oldSchema) {
                if (!newSchema[table]) diff.del.push(table);
            }
            for (var table in newSchema) {
                var oldDef = oldSchema[table],
                    newDef = newSchema[table];
                if (!oldDef) diff.add.push([table, newDef]);
                else {
                    var change = {
                        name: table,
                        def: newSchema[table],
                        recreate: false,
                        del: [],
                        add: [],
                        change: []
                    };
                    if (oldDef.primKey.src !== newDef.primKey.src) {
                        // Primary key has changed. Remove and re-add table.
                        change.recreate = true;
                        diff.change.push(change);
                    } else {
                        var oldIndexes = oldDef.indexes.reduce(function (prev, current) { prev[current.name] = current; return prev; }, {});
                        var newIndexes = newDef.indexes.reduce(function (prev, current) { prev[current.name] = current; return prev; }, {});
                        for (var idxName in oldIndexes) {
                            if (!newIndexes[idxName]) change.del.push(idxName);
                        }
                        for (var idxName in newIndexes) {
                            var oldIdx = oldIndexes[idxName],
                                newIdx = newIndexes[idxName];
                            if (!oldIdx) change.add.push(newIdx);
                            else if (oldIdx.src !== newIdx.src) change.change.push(newIdx);
                        }
                        if (change.recreate || change.del.length > 0 || change.add.length > 0 || change.change.length > 0) {
                            diff.change.push(change);
                        }
                    }
                }
            }
            return diff;
        }

        function createTable(idbtrans, tableName, primKey, indexes) {
            /// <param name="idbtrans" type="IDBTransaction"></param>
            var store = idbtrans.db.createObjectStore(tableName, primKey.keyPath ? { keyPath: primKey.keyPath, autoIncrement: primKey.auto } : { autoIncrement: primKey.auto });
            indexes.forEach(function (idx) { addIndex(store, idx); });
            return store;
        }

        function createMissingTables(newSchema, idbtrans) {
            Object.keys(newSchema).forEach(function (tableName) {
                if (!idbtrans.db.objectStoreNames.contains(tableName)) {
                    createTable(idbtrans, tableName, newSchema[tableName].primKey, newSchema[tableName].indexes);
                }
            });
        }

        function deleteRemovedTables(newSchema, idbtrans) {
            for (var i = 0; i < idbtrans.db.objectStoreNames.length; ++i) {
                var storeName = idbtrans.db.objectStoreNames[i];
                if (newSchema[storeName] === null || newSchema[storeName] === undefined) {
                    idbtrans.db.deleteObjectStore(storeName);
                }
            }
        }

        function addIndex(store, idx) {
            store.createIndex(idx.name, idx.keyPath, { unique: idx.unique, multiEntry: idx.multi });
        }

        //
        //
        //      Dexie Protected API
        //
        //

        this._allTables = allTables;

        this._tableFactory = function createTable(mode, tableSchema, transactionPromiseFactory) {
            /// <param name="tableSchema" type="TableSchema"></param>
            if (mode === READONLY)
                return new Table(tableSchema.name, transactionPromiseFactory, tableSchema, Collection);
            else
                return new WriteableTable(tableSchema.name, transactionPromiseFactory, tableSchema);
        }; 

        this._createTransaction = function (mode, storeNames, dbschema, parentTransaction) {
            return new Transaction(mode, storeNames, dbschema, parentTransaction);
        }; 

        function tableNotInTransaction(mode, storeNames) {
            throw new Error("Table " + storeNames[0] + " not part of transaction. Original Scope Function Source: " + Dexie.Promise.PSD.trans.scopeFunc.toString());
        }

        this._transPromiseFactory = function transactionPromiseFactory(mode, storeNames, fn) { // Last argument is "writeLocked". But this doesnt apply to oneshot direct db operations, so we ignore it.
            if (db_is_blocked && (!Promise.PSD || !Promise.PSD.letThrough)) {
                // Database is paused. Wait til resumed.
                var blockedPromise = new Promise(function (resolve, reject) {
                    pausedResumeables.push({
                        resume: function () {
                            var p = db._transPromiseFactory(mode, storeNames, fn);
                            blockedPromise.onuncatched = p.onuncatched;
                            p.then(resolve, reject);
                        }
                    });
                });
                return blockedPromise;
            } else {
                var trans = db._createTransaction(mode, storeNames, globalSchema);
                return trans._promise(mode, function (resolve, reject) {
                    // An uncatched operation will bubble to this anonymous transaction. Make sure
                    // to continue bubbling it up to db.on('error'):
                    trans.error(function (err) {
                        db.on('error').fire(err);
                    });
                    fn(function (value) {
                        // Instead of resolving value directly, wait with resolving it until transaction has completed.
                        // Otherwise the data would not be in the DB if requesting it in the then() operation.
                        // Specifically, to ensure that the following expression will work:
                        //
                        //   db.friends.put({name: "Arne"}).then(function () {
                        //       db.friends.where("name").equals("Arne").count(function(count) {
                        //           assert (count === 1);
                        //       });
                        //   });
                        //
                        trans.complete(function () {
                            resolve(value);
                        });
                    }, reject, trans);
                });
            }
        }; 

        this._whenReady = function (fn) {
            if (db_is_blocked && (!Promise.PSD || !Promise.PSD.letThrough)) {
                return new Promise(function (resolve, reject) {
                    pausedResumeables.push({
                        resume: function () {
                            fn(resolve, reject);
                        }
                    });
                });
            }
            return new Promise(fn);
        }; 

        //
        //
        //
        //
        //      Dexie API
        //
        //
        //

        this.verno = 0;

        this.open = function () {
            return new Promise(function (resolve, reject) {
                if (idbdb || isBeingOpened) throw new Error("Database already opened or being opened");
                var req, dbWasCreated = false;
                function openError(err) {
                    try { req.transaction.abort(); } catch (e) { }
                    /*if (dbWasCreated) {
                        // Workaround for issue with some browsers. Seem not to be needed though.
                        // Unit test "Issue#100 - not all indexes are created" works without it on chrome,FF,opera and IE.
                        idbdb.close();
                        indexedDB.deleteDatabase(db.name); 
                    }*/
                    isBeingOpened = false;
                    dbOpenError = err;
                    db_is_blocked = false;
                    reject(dbOpenError);
                    pausedResumeables.forEach(function (resumable) {
                        // Resume all stalled operations. They will fail once they wake up.
                        resumable.resume();
                    });
                    pausedResumeables = [];
                }
                try {
                    dbOpenError = null;
                    isBeingOpened = true;

                    // Make sure caller has specified at least one version
                    if (versions.length === 0) {
                        autoSchema = true;
                    }

                    // Multiply db.verno with 10 will be needed to workaround upgrading bug in IE: 
                    // IE fails when deleting objectStore after reading from it.
                    // A future version of Dexie.js will stopover an intermediate version to workaround this.
                    // At that point, we want to be backward compatible. Could have been multiplied with 2, but by using 10, it is easier to map the number to the real version number.
                    if (!indexedDB) throw new Error("indexedDB API not found. If using IE10+, make sure to run your code on a server URL (not locally). If using Safari, make sure to include indexedDB polyfill.");
                    req = autoSchema ? indexedDB.open(dbName) : indexedDB.open(dbName, Math.round(db.verno * 10));
                    req.onerror = eventRejectHandler(openError, ["opening database", dbName]);
                    req.onblocked = function (ev) {
                        db.on("blocked").fire(ev);
                    }; 
                    req.onupgradeneeded = trycatch (function (e) {
                        if (autoSchema && !db._allowEmptyDB) { // Unless an addon has specified db._allowEmptyDB, lets make the call fail.
                            // Caller did not specify a version or schema. Doing that is only acceptable for opening alread existing databases.
                            // If onupgradeneeded is called it means database did not exist. Reject the open() promise and make sure that we 
                            // do not create a new database by accident here.
                            req.onerror = function (event) { event.preventDefault(); }; // Prohibit onabort error from firing before we're done!
                            req.transaction.abort(); // Abort transaction (would hope that this would make DB disappear but it doesnt.)
                            // Close database and delete it.
                            req.result.close();
                            var delreq = indexedDB.deleteDatabase(dbName); // The upgrade transaction is atomic, and javascript is single threaded - meaning that there is no risk that we delete someone elses database here!
                            delreq.onsuccess = delreq.onerror = function () {
                                openError(new Error("Database '" + dbName + "' doesnt exist"));
                            }; 
                        } else {
                            if (e.oldVersion === 0) dbWasCreated = true;
                            req.transaction.onerror = eventRejectHandler(openError);
                            var oldVer = e.oldVersion > Math.pow(2, 62) ? 0 : e.oldVersion; // Safari 8 fix.
                            runUpgraders(oldVer / 10, req.transaction, openError, req);
                        }
                    }, openError);
                    req.onsuccess = trycatch(function (e) {
                        isBeingOpened = false;
                        idbdb = req.result;
                        if (autoSchema) readGlobalSchema();
                        else if (idbdb.objectStoreNames.length > 0)
                            adjustToExistingIndexNames(globalSchema, idbdb.transaction(safariMultiStoreFix(idbdb.objectStoreNames), READONLY));
                        idbdb.onversionchange = db.on("versionchange").fire; // Not firing it here, just setting the function callback to any registered subscriber.
                        if (!hasNativeGetDatabaseNames) {
                            // Update localStorage with list of database names
                            globalDatabaseList(function (databaseNames) {
                                if (databaseNames.indexOf(dbName) === -1) return databaseNames.push(dbName);
                            });
                        }
                        // Now, let any subscribers to the on("ready") fire BEFORE any other db operations resume!
                        // If an the on("ready") subscriber returns a Promise, we will wait til promise completes or rejects before 
                        Promise.newPSD(function () {
                            Promise.PSD.letThrough = true; // Set a Promise-Specific Data property informing that onready is firing. This will make db._whenReady() let the subscribers use the DB but block all others (!). Quite cool ha?
                            try {
                                var res = db.on.ready.fire();
                                if (res && typeof res.then === 'function') {
                                    // If on('ready') returns a promise, wait for it to complete and then resume any pending operations.
                                    res.then(resume, function (err) {
                                        idbdb.close();
                                        idbdb = null;
                                        openError(err);
                                    });
                                } else {
                                    asap(resume); // Cannot call resume directly because then the pauseResumables would inherit from our PSD scope.
                                }
                            } catch (e) {
                                openError(e);
                            }

                            function resume() {
                                db_is_blocked = false;
                                pausedResumeables.forEach(function (resumable) {
                                    // If anyone has made operations on a table instance before the db was opened, the operations will start executing now.
                                    resumable.resume();
                                });
                                pausedResumeables = [];
                                resolve(db);
                            }
                        });
                    }, openError);
                } catch (err) {
                    openError(err);
                }
            });
        }; 

        this.close = function () {
            if (idbdb) {
                idbdb.close();
                idbdb = null;
                db_is_blocked = true;
                dbOpenError = null;
            }
        }; 

        this.delete = function () {
            var args = arguments;
            return new Promise(function (resolve, reject) {
                if (args.length > 0) throw new Error("Arguments not allowed in db.delete()");
                function doDelete() {
                    db.close();
                    var req = indexedDB.deleteDatabase(dbName);
                    req.onsuccess = function () {
                        if (!hasNativeGetDatabaseNames) {
                            globalDatabaseList(function(databaseNames) {
                                var pos = databaseNames.indexOf(dbName);
                                if (pos >= 0) return databaseNames.splice(pos, 1);
                            });
                        }
                        resolve();
                    };
                    req.onerror = eventRejectHandler(reject, ["deleting", dbName]);
                    req.onblocked = function() {
                        db.on("blocked").fire();
                    };
                }
                if (isBeingOpened) {
                    pausedResumeables.push({ resume: doDelete });
                } else {
                    doDelete();
                }
            });
        }; 

        this.backendDB = function () {
            return idbdb;
        }; 

        this.isOpen = function () {
            return idbdb !== null;
        }; 
        this.hasFailed = function () {
            return dbOpenError !== null;
        };
        this.dynamicallyOpened = function() {
            return autoSchema;
        }

        /*this.dbg = function (collection, counter) {
            if (!this._dbgResult || !this._dbgResult[counter]) {
                if (typeof collection === 'string') collection = this.table(collection).toCollection().limit(100);
                if (!this._dbgResult) this._dbgResult = [];
                var db = this;
                new Promise(function () {
                    Promise.PSD.letThrough = true;
                    db._dbgResult[counter] = collection.toArray();
                });
            }
            return this._dbgResult[counter]._value;
        }*/

        //
        // Properties
        //
        this.name = dbName;

        // db.tables - an array of all Table instances.
        // TODO: Change so that tables is a simple member and make sure to update it whenever allTables changes.
        Object.defineProperty(this, "tables", {
            get: function () {
                /// <returns type="Array" elementType="WriteableTable" />
                return Object.keys(allTables).map(function (name) { return allTables[name]; });
            }
        });

        //
        // Events
        //
        this.on = events(this, "error", "populate", "blocked", { "ready": [promisableChain, nop], "versionchange": [reverseStoppableEventChain, nop] });

        // Handle on('ready') specifically: If DB is already open, trigger the event immediately. Also, default to unsubscribe immediately after being triggered.
        this.on.ready.subscribe = override(this.on.ready.subscribe, function (origSubscribe) {
            return function (subscriber, bSticky) {
                function proxy () {
                    if (!bSticky) db.on.ready.unsubscribe(proxy);
                    return subscriber.apply(this, arguments);
                }
                origSubscribe.call(this, proxy);
                if (db.isOpen()) {
                    if (db_is_blocked) {
                        pausedResumeables.push({ resume: proxy });
                    } else {
                        proxy();
                    }
                }
            };
        });

        fakeAutoComplete(function () {
            db.on("populate").fire(db._createTransaction(READWRITE, dbStoreNames, globalSchema));
            db.on("error").fire(new Error());
        });

        this.transaction = function (mode, tableInstances, scopeFunc) {
            /// <summary>
            /// 
            /// </summary>
            /// <param name="mode" type="String">"r" for readonly, or "rw" for readwrite</param>
            /// <param name="tableInstances">Table instance, Array of Table instances, String or String Array of object stores to include in the transaction</param>
            /// <param name="scopeFunc" type="Function">Function to execute with transaction</param>

            // Let table arguments be all arguments between mode and last argument.
            tableInstances = [].slice.call(arguments, 1, arguments.length - 1);
            // Let scopeFunc be the last argument
            scopeFunc = arguments[arguments.length - 1];
            var parentTransaction = Promise.PSD && Promise.PSD.trans;
			// Check if parent transactions is bound to this db instance, and if caller wants to reuse it
            if (!parentTransaction || parentTransaction.db !== db || mode.indexOf('!') !== -1) parentTransaction = null;
            var onlyIfCompatible = mode.indexOf('?') !== -1;
            mode = mode.replace('!', '').replace('?', '');
            //
            // Get storeNames from arguments. Either through given table instances, or through given table names.
            //
            var tables = Array.isArray(tableInstances[0]) ? tableInstances.reduce(function (a, b) { return a.concat(b); }) : tableInstances;
            var error = null;
            var storeNames = tables.map(function (tableInstance) {
                if (typeof tableInstance === "string") {
                    return tableInstance;
                } else {
                    if (!(tableInstance instanceof Table)) error = error || new TypeError("Invalid type. Arguments following mode must be instances of Table or String");
                    return tableInstance.name;
                }
            });

            //
            // Resolve mode. Allow shortcuts "r" and "rw".
            //
            if (mode == "r" || mode == READONLY)
                mode = READONLY;
            else if (mode == "rw" || mode == READWRITE)
                mode = READWRITE;
            else
                error = new Error("Invalid transaction mode: " + mode);

            if (parentTransaction) {
                // Basic checks
                if (!error) {
                    if (parentTransaction && parentTransaction.mode === READONLY && mode === READWRITE) {
                        if (onlyIfCompatible) parentTransaction = null; // Spawn new transaction instead.
                        else error = error || new Error("Cannot enter a sub-transaction with READWRITE mode when parent transaction is READONLY");
                    }
                    if (parentTransaction) {
                        storeNames.forEach(function (storeName) {
                            if (!parentTransaction.tables.hasOwnProperty(storeName)) {
                                if (onlyIfCompatible) parentTransaction = null; // Spawn new transaction instead.
                                else error = error || new Error("Table " + storeName + " not included in parent transaction. Parent Transaction function: " + parentTransaction.scopeFunc.toString());
                            }
                        });
                    }
                }
            }
            if (parentTransaction) {
                // If this is a sub-transaction, lock the parent and then launch the sub-transaction.
                return parentTransaction._promise(mode, enterTransactionScope, "lock");
            } else {
                // If this is a root-level transaction, wait til database is ready and then launch the transaction.
                return db._whenReady(enterTransactionScope);
            }

            function enterTransactionScope(resolve, reject) {
                // Our transaction. To be set later.
                var trans = null;

                try {
                    // Throw any error if any of the above checks failed.
                    // Real error defined some lines up. We throw it here from within a Promise to reject Promise
                    // rather than make caller need to both use try..catch and promise catching. The reason we still
                    // throw here rather than do Promise.reject(error) is that we like to have the stack attached to the
                    // error. Also because there is a catch() clause bound to this try() that will bubble the error
                    // to the parent transaction.
                    if (error) throw error;

                    //
                    // Create Transaction instance
                    //
                    trans = db._createTransaction(mode, storeNames, globalSchema, parentTransaction);

                    // Provide arguments to the scope function (for backward compatibility)
                    var tableArgs = storeNames.map(function (name) { return trans.tables[name]; });
                    tableArgs.push(trans);

                    // If transaction completes, resolve the Promise with the return value of scopeFunc.
                    var returnValue;
                    var uncompletedRequests = 0;

                    // Create a new PSD frame to hold Promise.PSD.trans. Must not be bound to the current PSD frame since we want
                    // it to pop before then() callback is called of our returned Promise.
                    Promise.newPSD(function () {
                        // Let the transaction instance be part of a Promise-specific data (PSD) value.
                        Promise.PSD.trans = trans;
                        trans.scopeFunc = scopeFunc; // For Error ("Table " + storeNames[0] + " not part of transaction") when it happens. This may help localizing the code that started a transaction used on another place.

                        if (parentTransaction) {
                            // Emulate transaction commit awareness for inner transaction (must 'commit' when the inner transaction has no more operations ongoing)
                            trans.idbtrans = parentTransaction.idbtrans;
                            trans._promise = override(trans._promise, function (orig) {
                                return function (mode, fn, writeLock) {
                                    ++uncompletedRequests;
                                    function proxy(fn2) {
                                        return function (val) {
                                            var retval;
                                            // _rootExec needed so that we do not loose any IDBTransaction in a setTimeout() call.
                                            Promise._rootExec(function () {
                                                retval = fn2(val);
                                                // _tickFinalize makes sure to support lazy micro tasks executed in Promise._rootExec().
                                                // We certainly do not want to copy the bad pattern from IndexedDB but instead allow
                                                // execution of Promise.then() callbacks until the're all done.
                                                Promise._tickFinalize(function () {
                                                    if (--uncompletedRequests === 0 && trans.active) {
                                                        trans.active = false;
                                                        trans.on.complete.fire(); // A called db operation has completed without starting a new operation. The flow is finished
                                                    }
                                                });
                                            });
                                            return retval;
                                        }
                                    }
                                    return orig.call(this, mode, function (resolve2, reject2, trans) {
                                        return fn(proxy(resolve2), proxy(reject2), trans);
                                    }, writeLock);
                                };
                            });
                        }
                        trans.complete(function () {
                            resolve(returnValue);
                        });
                        // If transaction fails, reject the Promise and bubble to db if noone catched this rejection.
                        trans.error(function (e) {
                            if (trans.idbtrans) trans.idbtrans.onerror = preventDefault; // Prohibit AbortError from firing.
                            try {trans.abort();} catch(e2){}
                            if (parentTransaction) {
                                parentTransaction.active = false;
                                parentTransaction.on.error.fire(e); // Bubble to parent transaction
                            }
                            var catched = reject(e);
                            if (!parentTransaction && !catched) {
                                db.on.error.fire(e);// If not catched, bubble error to db.on("error").
                            }
                        });

                        // Finally, call the scope function with our table and transaction arguments.
                        Promise._rootExec(function() {
                            returnValue = scopeFunc.apply(trans, tableArgs); // NOTE: returnValue is used in trans.on.complete() not as a returnValue to this func.
                        });
                    });
                    if (!trans.idbtrans || (parentTransaction && uncompletedRequests === 0)) {
                        trans._nop(); // Make sure transaction is being used so that it will resolve.
                    }
                } catch (e) {
                    // If exception occur, abort the transaction and reject Promise.
                    if (trans && trans.idbtrans) trans.idbtrans.onerror = preventDefault; // Prohibit AbortError from firing.
                    if (trans) trans.abort();
                    if (parentTransaction) parentTransaction.on.error.fire(e);
                    asap(function () {
                        // Need to use asap(=setImmediate/setTimeout) before calling reject because we are in the Promise constructor and reject() will always return false if so.
                        if (!reject(e)) db.on("error").fire(e); // If not catched, bubble exception to db.on("error");
                    });
                }
            }
        }; 

        this.table = function (tableName) {
            /// <returns type="WriteableTable"></returns>
            if (!autoSchema && !allTables.hasOwnProperty(tableName)) { throw new Error("Table does not exist"); return { AN_UNKNOWN_TABLE_NAME_WAS_SPECIFIED: 1 }; }
            return allTables[tableName];
        }; 

        //
        //
        //
        // Table Class
        //
        //
        //
        function Table(name, transactionPromiseFactory, tableSchema, collClass) {
            /// <param name="name" type="String"></param>
            this.name = name;
            this.schema = tableSchema;
            this.hook = allTables[name] ? allTables[name].hook : events(null, {
                "creating": [hookCreatingChain, nop],
                "reading": [pureFunctionChain, mirror],
                "updating": [hookUpdatingChain, nop],
                "deleting": [nonStoppableEventChain, nop]
            });
            this._tpf = transactionPromiseFactory;
            this._collClass = collClass || Collection;
        }

        extend(Table.prototype, function () {
            function failReadonly() {
                throw new Error("Current Transaction is READONLY");
            }
            return {
                //
                // Table Protected Methods
                //

                _trans: function getTransaction(mode, fn, writeLocked) {
                    return this._tpf(mode, [this.name], fn, writeLocked);
                },
                _idbstore: function getIDBObjectStore(mode, fn, writeLocked) {
                    if (fake) return new Promise(fn); // Simplify the work for Intellisense/Code completion.
                    var self = this;
                    return this._tpf(mode, [this.name], function (resolve, reject, trans) {
                        fn(resolve, reject, trans.idbtrans.objectStore(self.name), trans);
                    }, writeLocked);
                },

                //
                // Table Public Methods
                //
                get: function (key, cb) {
                    var self = this;
                    return this._idbstore(READONLY, function (resolve, reject, idbstore) {
                        fake && resolve(self.schema.instanceTemplate);
                        var req = idbstore.get(key);
                        req.onerror = eventRejectHandler(reject, ["getting", key, "from", self.name]);
                        req.onsuccess = function () {
                            resolve(self.hook.reading.fire(req.result));
                        };
                    }).then(cb);
                },
                where: function (indexName) {
                    return new WhereClause(this, indexName);
                },
                count: function (cb) {
                    return this.toCollection().count(cb);
                },
                offset: function (offset) {
                    return this.toCollection().offset(offset);
                },
                limit: function (numRows) {
                    return this.toCollection().limit(numRows);
                },
                reverse: function () {
                    return this.toCollection().reverse();
                },
                filter: function (filterFunction) {
                    return this.toCollection().and(filterFunction);
                },
                each: function (fn) {
                    var self = this;
                    fake && fn(self.schema.instanceTemplate);
                    return this._idbstore(READONLY, function (resolve, reject, idbstore) {
                        var req = idbstore.openCursor();
                        req.onerror = eventRejectHandler(reject, ["calling", "Table.each()", "on", self.name]);
                        iterate(req, null, fn, resolve, reject, self.hook.reading.fire);
                    });
                },
                toArray: function (cb) {
                    var self = this;
                    return this._idbstore(READONLY, function (resolve, reject, idbstore) {
                        fake && resolve([self.schema.instanceTemplate]);
                        var a = [];
                        var req = idbstore.openCursor();
                        req.onerror = eventRejectHandler(reject, ["calling", "Table.toArray()", "on", self.name]);
                        iterate(req, null, function (item) { a.push(item); }, function () { resolve(a); }, reject, self.hook.reading.fire);
                    }).then(cb);
                },
                orderBy: function (index) {
                    return new this._collClass(new WhereClause(this, index));
                },

                toCollection: function () {
                    return new this._collClass(new WhereClause(this));
                },

                mapToClass: function (constructor, structure) {
                    /// <summary>
                    ///     Map table to a javascript constructor function. Objects returned from the database will be instances of this class, making
                    ///     it possible to the instanceOf operator as well as extending the class using constructor.prototype.method = function(){...}.
                    /// </summary>
                    /// <param name="constructor">Constructor function representing the class.</param>
                    /// <param name="structure" optional="true">Helps IDE code completion by knowing the members that objects contain and not just the indexes. Also
                    /// know what type each member has. Example: {name: String, emailAddresses: [String], password}</param>
                    this.schema.mappedClass = constructor;
                    var instanceTemplate = Object.create(constructor.prototype);
                    if (structure) {
                        // structure and instanceTemplate is for IDE code competion only while constructor.prototype is for actual inheritance.
                        applyStructure(instanceTemplate, structure);
                    }
                    this.schema.instanceTemplate = instanceTemplate;

                    // Now, subscribe to the when("reading") event to make all objects that come out from this table inherit from given class
                    // no matter which method to use for reading (Table.get() or Table.where(...)... )
                    var readHook = function (obj) {
                        if (!obj) return obj; // No valid object. (Value is null). Return as is.
                        // Create a new object that derives from constructor:
                        var res = Object.create(constructor.prototype);
                        // Clone members:
                        for (var m in obj) if (obj.hasOwnProperty(m)) res[m] = obj[m];
                        return res;
                    };

                    if (this.schema.readHook) {
                        this.hook.reading.unsubscribe(this.schema.readHook);
                    }
                    this.schema.readHook = readHook;
                    this.hook("reading", readHook);
                    return constructor;
                },
                defineClass: function (structure) {
                    /// <summary>
                    ///     Define all members of the class that represents the table. This will help code completion of when objects are read from the database
                    ///     as well as making it possible to extend the prototype of the returned constructor function.
                    /// </summary>
                    /// <param name="structure">Helps IDE code completion by knowing the members that objects contain and not just the indexes. Also
                    /// know what type each member has. Example: {name: String, emailAddresses: [String], properties: {shoeSize: Number}}</param>
                    return this.mapToClass(Dexie.defineClass(structure), structure);
                },
                add: failReadonly,
                put: failReadonly,
                'delete': failReadonly,
                clear: failReadonly,
                update: failReadonly
            };
        });

        //
        //
        //
        // WriteableTable Class (extends Table)
        //
        //
        //
        function WriteableTable(name, transactionPromiseFactory, tableSchema, collClass) {
            Table.call(this, name, transactionPromiseFactory, tableSchema, collClass || WriteableCollection);
        }

        derive(WriteableTable).from(Table).extend(function () {
            return {
                add: function (obj, key) {
                    /// <summary>
                    ///   Add an object to the database. In case an object with same primary key already exists, the object will not be added.
                    /// </summary>
                    /// <param name="obj" type="Object">A javascript object to insert</param>
                    /// <param name="key" optional="true">Primary key</param>
                    var self = this,
                        creatingHook = this.hook.creating.fire;
                    return this._idbstore(READWRITE, function (resolve, reject, idbstore, trans) {
                        var thisCtx = {};
                        if (creatingHook !== nop) {
                            var effectiveKey = key || (idbstore.keyPath ? getByKeyPath(obj, idbstore.keyPath) : undefined);
                            var keyToUse = creatingHook.call(thisCtx, effectiveKey, obj, trans); // Allow subscribers to when("creating") to generate the key.
                            if (effectiveKey === undefined && keyToUse !== undefined) {
                                if (idbstore.keyPath)
                                    setByKeyPath(obj, idbstore.keyPath, keyToUse);
                                else
                                    key = keyToUse;
                            }
                        }
                        //try {
                            var req = key ? idbstore.add(obj, key) : idbstore.add(obj);
                            req.onerror = eventRejectHandler(function (e) {
                                if (thisCtx.onerror) thisCtx.onerror(e);
                                return reject(e);
                            }, ["adding", obj, "into", self.name]);
                            req.onsuccess = function (ev) {
                                var keyPath = idbstore.keyPath;
                                if (keyPath) setByKeyPath(obj, keyPath, ev.target.result);
                                if (thisCtx.onsuccess) thisCtx.onsuccess(ev.target.result);
                                resolve(req.result);
                            };
                        /*} catch (e) {
                            trans.on("error").fire(e);
                            trans.abort();
                            reject(e);
                        }*/
                    });
                },

                put: function (obj, key) {
                    /// <summary>
                    ///   Add an object to the database but in case an object with same primary key alread exists, the existing one will get updated.
                    /// </summary>
                    /// <param name="obj" type="Object">A javascript object to insert or update</param>
                    /// <param name="key" optional="true">Primary key</param>
                    var self = this,
                        creatingHook = this.hook.creating.fire,
                        updatingHook = this.hook.updating.fire;
                    if (creatingHook !== nop || updatingHook !== nop) {
                        //
                        // People listens to when("creating") or when("updating") events!
                        // We must know whether the put operation results in an CREATE or UPDATE.
                        //
                        return this._trans(READWRITE, function (resolve, reject, trans) {
                            // Since key is optional, make sure we get it from obj if not provided
                            var effectiveKey = key || (self.schema.primKey.keyPath && getByKeyPath(obj, self.schema.primKey.keyPath));
                            if (effectiveKey === undefined) {
                                // No primary key. Must use add().
                                trans.tables[self.name].add(obj).then(resolve, reject);
                            } else {
                                // Primary key exist. Lock transaction and try modifying existing. If nothing modified, call add().
                                trans._lock(); // Needed because operation is splitted into modify() and add().
                                // clone obj before this async call. If caller modifies obj the line after put(), the IDB spec requires that it should not affect operation.
                                obj = deepClone(obj);
                                trans.tables[self.name].where(":id").equals(effectiveKey).modify(function (value) {
                                    // Replace extisting value with our object
                                    // CRUD event firing handled in WriteableCollection.modify()
                                    this.value = obj;
                                }).then(function (count) {
                                    if (count === 0) {
                                        // Object's key was not found. Add the object instead.
                                        // CRUD event firing will be done in add()
                                        return trans.tables[self.name].add(obj, key); // Resolving with another Promise. Returned Promise will then resolve with the new key.
                                    } else {
                                        return effectiveKey; // Resolve with the provided key.
                                    }
                                }).finally(function () {
                                    trans._unlock();
                                }).then(resolve, reject);
                            }
                        });
                    } else {
                        // Use the standard IDB put() method.
                        return this._idbstore(READWRITE, function (resolve, reject, idbstore) {
                            var req = key ? idbstore.put(obj, key) : idbstore.put(obj);
                            req.onerror = eventRejectHandler(reject, ["putting", obj, "into", self.name]);
                            req.onsuccess = function (ev) {
                                var keyPath = idbstore.keyPath;
                                if (keyPath) setByKeyPath(obj, keyPath, ev.target.result);
                                resolve(req.result);
                            };
                        });
                    }
                },

                'delete': function (key) {
                    /// <param name="key">Primary key of the object to delete</param>
                    if (this.hook.deleting.subscribers.length) {
                        // People listens to when("deleting") event. Must implement delete using WriteableCollection.delete() that will
                        // call the CRUD event. Only WriteableCollection.delete() will know whether an object was actually deleted.
                        return this.where(":id").equals(key).delete();
                    } else {
                        // No one listens. Use standard IDB delete() method.
                        return this._idbstore(READWRITE, function (resolve, reject, idbstore) {
                            var req = idbstore.delete(key);
                            req.onerror = eventRejectHandler(reject, ["deleting", key, "from", idbstore.name]);
                            req.onsuccess = function (ev) {
                                resolve(req.result);
                            };
                        });
                    }
                },

                clear: function () {
                    if (this.hook.deleting.subscribers.length) {
                        // People listens to when("deleting") event. Must implement delete using WriteableCollection.delete() that will
                        // call the CRUD event. Only WriteableCollection.delete() will knows which objects that are actually deleted.
                        return this.toCollection().delete();
                    } else {
                        return this._idbstore(READWRITE, function (resolve, reject, idbstore) {
                            var req = idbstore.clear();
                            req.onerror = eventRejectHandler(reject, ["clearing", idbstore.name]);
                            req.onsuccess = function (ev) {
                                resolve(req.result);
                            };
                        });
                    }
                },

                update: function (keyOrObject, modifications) {
                    if (typeof modifications !== 'object' || Array.isArray(modifications)) throw new Error("db.update(keyOrObject, modifications). modifications must be an object.");
                    if (typeof keyOrObject === 'object' && !Array.isArray(keyOrObject)) {
                        // object to modify. Also modify given object with the modifications:
                        Object.keys(modifications).forEach(function (keyPath) {
                            setByKeyPath(keyOrObject, keyPath, modifications[keyPath]);
                        });
                        var key = getByKeyPath(keyOrObject, this.schema.primKey.keyPath);
                        if (key === undefined) Promise.reject(new Error("Object does not contain its primary key"));
                        return this.where(":id").equals(key).modify(modifications);
                    } else {
                        // key to modify
                        return this.where(":id").equals(keyOrObject).modify(modifications);
                    }
                },
            };
        });

        //
        //
        //
        // Transaction Class
        //
        //
        //
        function Transaction(mode, storeNames, dbschema, parent) {
            /// <summary>
            ///    Transaction class. Represents a database transaction. All operations on db goes through a Transaction.
            /// </summary>
            /// <param name="mode" type="String">Any of "readwrite" or "readonly"</param>
            /// <param name="storeNames" type="Array">Array of table names to operate on</param>
            var self = this;
            this.db = db;
            this.mode = mode;
            this.storeNames = storeNames;
            this.idbtrans = null;
            this.on = events(this, ["complete", "error"], "abort");
            this._reculock = 0;
            this._blockedFuncs = [];
            this._psd = null;
            this.active = true;
            this._dbschema = dbschema;
            if (parent) this.parent = parent;
            this._tpf = transactionPromiseFactory;
            this.tables = Object.create(notInTransFallbackTables); // ...so that all non-included tables exists as instances (possible to call table.name for example) but will fail as soon as trying to execute a query on it.

            function transactionPromiseFactory(mode, storeNames, fn, writeLocked) {
                // Creates a Promise instance and calls fn (resolve, reject, trans) where trans is the instance of this transaction object.
                // Support for write-locking the transaction during the promise life time from creation to success/failure.
                // This is actually not needed when just using single operations on IDB, since IDB implements this internally.
                // However, when implementing a write operation as a series of operations on top of IDB(collection.delete() and collection.modify() for example),
                // lock is indeed needed if Dexie APIshould behave in a consistent manner for the API user.
                // Another example of this is if we want to support create/update/delete events,
                // we need to implement put() using a series of other IDB operations but still need to lock the transaction all the way.
                return self._promise(mode, fn, writeLocked);
            }

            for (var i = storeNames.length - 1; i !== -1; --i) {
                var name = storeNames[i];
                var table = db._tableFactory(mode, dbschema[name], transactionPromiseFactory);
                this.tables[name] = table;
                if (!this[name]) this[name] = table;
            }
        }

        extend(Transaction.prototype, {
            //
            // Transaction Protected Methods (not required by API users, but needed internally and eventually by dexie extensions)
            //

            _lock: function () {
                // Temporary set all requests into a pending queue if they are called before database is ready.
                ++this._reculock; // Recursive read/write lock pattern using PSD (Promise Specific Data) instead of TLS (Thread Local Storage)
                if (this._reculock === 1 && Promise.PSD) Promise.PSD.lockOwnerFor = this;
                return this;
            },
            _unlock: function () {
                if (--this._reculock === 0) {
                    if (Promise.PSD) Promise.PSD.lockOwnerFor = null;
                    while (this._blockedFuncs.length > 0 && !this._locked()) {
                        var fn = this._blockedFuncs.shift();
                        try { fn(); } catch (e) { }
                    }
                }
                return this;
            },
            _locked: function () {
                // Checks if any write-lock is applied on this transaction.
                // To simplify the Dexie API for extension implementations, we support recursive locks.
                // This is accomplished by using "Promise Specific Data" (PSD).
                // PSD data is bound to a Promise and any child Promise emitted through then() or resolve( new Promise() ).
                // Promise.PSD is local to code executing on top of the call stacks of any of any code executed by Promise():
                //         * callback given to the Promise() constructor  (function (resolve, reject){...})
                //         * callbacks given to then()/catch()/finally() methods (function (value){...})
                // If creating a new independant Promise instance from within a Promise call stack, the new Promise will derive the PSD from the call stack of the parent Promise.
                // Derivation is done so that the inner PSD __proto__ points to the outer PSD.
                // Promise.PSD.lockOwnerFor will point to current transaction object if the currently executing PSD scope owns the lock.
                return this._reculock && (!Promise.PSD || Promise.PSD.lockOwnerFor !== this);
            },
            _nop: function (cb) {
                // An asyncronic no-operation that may call given callback when done doing nothing. An alternative to asap() if we must not lose the transaction.
                this.tables[this.storeNames[0]].get(0).then(cb);
            },
            _promise: function (mode, fn, bWriteLock) {
                var self = this;
                return Promise.newPSD(function() {
                    var p;
                    // Read lock always
                    if (!self._locked()) {
                        p = self.active ? new Promise(function (resolve, reject) {
                            if (!self.idbtrans && mode) {
                                if (!idbdb) throw dbOpenError ? new Error("Database not open. Following error in populate, ready or upgrade function made Dexie.open() fail: " + dbOpenError) : new Error("Database not open");
                                var idbtrans = self.idbtrans = idbdb.transaction(safariMultiStoreFix(self.storeNames), self.mode);
                                idbtrans.onerror = function (e) {
                                    self.on("error").fire(e && e.target.error);
                                    e.preventDefault(); // Prohibit default bubbling to window.error
                                    self.abort(); // Make sure transaction is aborted since we preventDefault.
                                }; 
                                idbtrans.onabort = function (e) {
                                    self.active = false;
                                    self.on("abort").fire(e);
                                }; 
                                idbtrans.oncomplete = function (e) {
                                    self.active = false;
                                    self.on("complete").fire(e);
                                }; 
                            }
                            if (bWriteLock) self._lock(); // Write lock if write operation is requested
                            try {
                                fn(resolve, reject, self);
                            } catch (e) {
                                // Direct exception happened when doin operation.
                                // We must immediately fire the error and abort the transaction.
                                // When this happens we are still constructing the Promise so we don't yet know
                                // whether the caller is about to catch() the error or not. Have to make
                                // transaction fail. Catching such an error wont stop transaction from failing.
                                // This is a limitation we have to live with.
                                Dexie.ignoreTransaction(function () { self.on('error').fire(e); });
                                self.abort();
                                reject(e);
                            }
                        }) : Promise.reject(stack(new Error("Transaction is inactive. Original Scope Function Source: " + self.scopeFunc.toString())));
                        if (self.active && bWriteLock) p.finally(function () {
                            self._unlock();
                        });
                    } else {
                        // Transaction is write-locked. Wait for mutex.
                        p = new Promise(function (resolve, reject) {
                            self._blockedFuncs.push(function () {
                                self._promise(mode, fn, bWriteLock).then(resolve, reject);
                            });
                        });
                    }
                    p.onuncatched = function (e) {
                        // Bubble to transaction. Even though IDB does this internally, it would just do it for error events and not for caught exceptions.
                        Dexie.ignoreTransaction(function () { self.on("error").fire(e); });
                        self.abort();
                    };
                    return p;
                });
            },

            //
            // Transaction Public Methods
            //

            complete: function (cb) {
                return this.on("complete", cb);
            },
            error: function (cb) {
                return this.on("error", cb);
            },
            abort: function () {
                if (this.idbtrans && this.active) try { // TODO: if !this.idbtrans, enqueue an abort() operation.
                    this.active = false;
                    this.idbtrans.abort();
                    this.on.error.fire(new Error("Transaction Aborted"));
                } catch (e) { }
            },
            table: function (name) {
                if (!this.tables.hasOwnProperty(name)) { throw new Error("Table " + name + " not in transaction"); return { AN_UNKNOWN_TABLE_NAME_WAS_SPECIFIED: 1 }; }
                return this.tables[name];
            }
        });

        //
        //
        //
        // WhereClause
        //
        //
        //
        function WhereClause(table, index, orCollection) {
            /// <param name="table" type="Table"></param>
            /// <param name="index" type="String" optional="true"></param>
            /// <param name="orCollection" type="Collection" optional="true"></param>
            this._ctx = {
                table: table,
                index: index === ":id" ? null : index,
                collClass: table._collClass,
                or: orCollection
            }; 
        }

        extend(WhereClause.prototype, function () {

            // WhereClause private methods

            function fail(collection, err) {
                try { throw err; } catch (e) {
                    collection._ctx.error = e;
                }
                return collection;
            }

            function getSetArgs(args) {
                return Array.prototype.slice.call(args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
            }

            function upperFactory(dir) {
                return dir === "next" ? function (s) { return s.toUpperCase(); } : function (s) { return s.toLowerCase(); };
            }
            function lowerFactory(dir) {
                return dir === "next" ? function (s) { return s.toLowerCase(); } : function (s) { return s.toUpperCase(); };
            }
            function nextCasing(key, lowerKey, upperNeedle, lowerNeedle, cmp, dir) {
                var length = Math.min(key.length, lowerNeedle.length);
                var llp = -1;
                for (var i = 0; i < length; ++i) {
                    var lwrKeyChar = lowerKey[i];
                    if (lwrKeyChar !== lowerNeedle[i]) {
                        if (cmp(key[i], upperNeedle[i]) < 0) return key.substr(0, i) + upperNeedle[i] + upperNeedle.substr(i + 1);
                        if (cmp(key[i], lowerNeedle[i]) < 0) return key.substr(0, i) + lowerNeedle[i] + upperNeedle.substr(i + 1);
                        if (llp >= 0) return key.substr(0, llp) + lowerKey[llp] + upperNeedle.substr(llp + 1);
                        return null;
                    }
                    if (cmp(key[i], lwrKeyChar) < 0) llp = i;
                }
                if (length < lowerNeedle.length && dir === "next") return key + upperNeedle.substr(key.length);
                if (length < key.length && dir === "prev") return key.substr(0, upperNeedle.length);
                return (llp < 0 ? null : key.substr(0, llp) + lowerNeedle[llp] + upperNeedle.substr(llp + 1));
            }

            function addIgnoreCaseAlgorithm(c, match, needle) {
                /// <param name="needle" type="String"></param>
                var upper, lower, compare, upperNeedle, lowerNeedle, direction;
                function initDirection(dir) {
                    upper = upperFactory(dir);
                    lower = lowerFactory(dir);
                    compare = (dir === "next" ? ascending : descending);
                    upperNeedle = upper(needle);
                    lowerNeedle = lower(needle);
                    direction = dir;
                }
                initDirection("next");
                c._ondirectionchange = function (direction) {
                    // This event onlys occur before filter is called the first time.
                    initDirection(direction);
                };
                c._addAlgorithm(function (cursor, advance, resolve) {
                    /// <param name="cursor" type="IDBCursor"></param>
                    /// <param name="advance" type="Function"></param>
                    /// <param name="resolve" type="Function"></param>
                    var key = cursor.key;
                    if (typeof key !== 'string') return false;
                    var lowerKey = lower(key);
                    if (match(lowerKey, lowerNeedle)) {
                        advance(function () { cursor.continue(); });
                        return true;
                    } else {
                        var nextNeedle = nextCasing(key, lowerKey, upperNeedle, lowerNeedle, compare, direction);
                        if (nextNeedle) {
                            advance(function () { cursor.continue(nextNeedle); });
                        } else {
                            advance(resolve);
                        }
                        return false;
                    }
                });
            }

            //
            // WhereClause public methods
            //
            return {
                between: function (lower, upper, includeLower, includeUpper) {
                    /// <summary>
                    ///     Filter out records whose where-field lays between given lower and upper values. Applies to Strings, Numbers and Dates.
                    /// </summary>
                    /// <param name="lower"></param>
                    /// <param name="upper"></param>
                    /// <param name="includeLower" optional="true">Whether items that equals lower should be included. Default true.</param>
                    /// <param name="includeUpper" optional="true">Whether items that equals upper should be included. Default false.</param>
                    /// <returns type="Collection"></returns>
                    includeLower = includeLower !== false;   // Default to true
                    includeUpper = includeUpper === true;    // Default to false
                    if ((lower > upper) ||
                        (lower === upper && (includeLower || includeUpper) && !(includeLower && includeUpper)))
                        return new this._ctx.collClass(this, function() { return IDBKeyRange.only(lower); }).limit(0); // Workaround for idiotic W3C Specification that DataError must be thrown if lower > upper. The natural result would be to return an empty collection.
                    return new this._ctx.collClass(this, function() { return IDBKeyRange.bound(lower, upper, !includeLower, !includeUpper); });
                },
                equals: function (value) {
                    return new this._ctx.collClass(this, function() { return IDBKeyRange.only(value); });
                },
                above: function (value) {
                    return new this._ctx.collClass(this, function() { return IDBKeyRange.lowerBound(value, true); });
                },
                aboveOrEqual: function (value) {
                    return new this._ctx.collClass(this, function() { return IDBKeyRange.lowerBound(value); });
                },
                below: function (value) {
                    return new this._ctx.collClass(this, function() { return IDBKeyRange.upperBound(value, true); });
                },
                belowOrEqual: function (value) {
                    return new this._ctx.collClass(this, function() { return IDBKeyRange.upperBound(value); });
                },
                startsWith: function (str) {
                    /// <param name="str" type="String"></param>
                    if (typeof str !== 'string') return fail(new this._ctx.collClass(this), new TypeError("String expected"));
                    return this.between(str, str + String.fromCharCode(65535), true, true);
                },
                startsWithIgnoreCase: function (str) {
                    /// <param name="str" type="String"></param>
                    if (typeof str !== 'string') return fail(new this._ctx.collClass(this), new TypeError("String expected"));
                    if (str === "") return this.startsWith(str);
                    var c = new this._ctx.collClass(this, function() { return IDBKeyRange.bound(str.toUpperCase(), str.toLowerCase() + String.fromCharCode(65535)); });
                    addIgnoreCaseAlgorithm(c, function (a, b) { return a.indexOf(b) === 0; }, str);
                    c._ondirectionchange = function () { fail(c, new Error("reverse() not supported with WhereClause.startsWithIgnoreCase()")); };
                    return c;
                },
                equalsIgnoreCase: function (str) {
                    /// <param name="str" type="String"></param>
                    if (typeof str !== 'string') return fail(new this._ctx.collClass(this), new TypeError("String expected"));
                    var c = new this._ctx.collClass(this, function() { return IDBKeyRange.bound(str.toUpperCase(), str.toLowerCase()); });
                    addIgnoreCaseAlgorithm(c, function (a, b) { return a === b; }, str);
                    return c;
                },
                anyOf: function (valueArray) {
                    var ctx = this._ctx,
                        schema = ctx.table.schema;
                    var idxSpec = ctx.index ? schema.idxByName[ctx.index] : schema.primKey;
                    var isCompound = idxSpec && idxSpec.compound;
                    var set = getSetArgs(arguments);
                    var compare = isCompound ? compoundCompare(ascending) : ascending;
                    set.sort(compare);
                    if (set.length === 0) return new this._ctx.collClass(this, function() { return IDBKeyRange.only(""); }).limit(0); // Return an empty collection.
                    var c = new this._ctx.collClass(this, function () { return IDBKeyRange.bound(set[0], set[set.length - 1]); });
                    
                    c._ondirectionchange = function (direction) {
                        compare = (direction === "next" ? ascending : descending);
                        if (isCompound) compare = compoundCompare(compare);
                        set.sort(compare);
                    };
                    var i = 0;
                    c._addAlgorithm(function (cursor, advance, resolve) {
                        var key = cursor.key;
                        while (compare(key, set[i]) > 0) {
                            // The cursor has passed beyond this key. Check next.
                            ++i;
                            if (i === set.length) {
                                // There is no next. Stop searching.
                                advance(resolve);
                                return false;
                            }
                        }
                        if (compare(key, set[i]) === 0) {
                            // The current cursor value should be included and we should continue a single step in case next item has the same key or possibly our next key in set.
                            advance(function () { cursor.continue(); });
                            return true;
                        } else {
                            // cursor.key not yet at set[i]. Forward cursor to the next key to hunt for.
                            advance(function () { cursor.continue(set[i]); });
                            return false;
                        }
                    });
                    return c;
                },

                notEqual: function(value) {
                    return this.below(value).or(this._ctx.index).above(value);
                },

                noneOf: function(valueArray) {
                    var ctx = this._ctx,
                        schema = ctx.table.schema;
                    var idxSpec = ctx.index ? schema.idxByName[ctx.index] : schema.primKey;
                    var isCompound = idxSpec && idxSpec.compound;
                    var set = getSetArgs(arguments);
                    if (set.length === 0) return new this._ctx.collClass(this); // Return entire collection.
                    var compare = isCompound ? compoundCompare(ascending) : ascending;
                    set.sort(compare);
                    // Transform ["a","b","c"] to a set of ranges for between/above/below: [[null,"a"], ["a","b"], ["b","c"], ["c",null]]
                    var ranges = set.reduce(function (res, val) { return res ? res.concat([[res[res.length - 1][1], val]]) : [[null, val]]; }, null);
                    ranges.push([set[set.length - 1], null]);
                    // Transform range-sets to a big or() expression between ranges:
                    var thiz = this, index = ctx.index;
                    return ranges.reduce(function(collection, range) {
                        return collection ?
                            range[1] === null ?
                                collection.or(index).above(range[0]) :
                                collection.or(index).between(range[0], range[1], false, false)
                            : thiz.below(range[1]);
                    }, null);
                },

                startsWithAnyOf: function (valueArray) {
                    var ctx = this._ctx,
                        set = getSetArgs(arguments);

                    if (!set.every(function (s) { return typeof s === 'string'; })) {
                        return fail(new ctx.collClass(this), new TypeError("startsWithAnyOf() only works with strings"));
                    }
                    if (set.length === 0) return new ctx.collClass(this, function () { return IDBKeyRange.only(""); }).limit(0); // Return an empty collection.

                    var setEnds = set.map(function (s) { return s + String.fromCharCode(65535); });
                    
                    var sortDirection = ascending;
                    set.sort(sortDirection);
                    var i = 0;
                    function keyIsBeyondCurrentEntry(key) { return key > setEnds[i]; }
                    function keyIsBeforeCurrentEntry(key) { return key < set[i]; }
                    var checkKey = keyIsBeyondCurrentEntry;

                    var c = new ctx.collClass(this, function () {
                        return IDBKeyRange.bound(set[0], set[set.length - 1] + String.fromCharCode(65535));
                    });
                    
                    c._ondirectionchange = function (direction) {
                        if (direction === "next") {
                            checkKey = keyIsBeyondCurrentEntry;
                            sortDirection = ascending;
                        } else {
                            checkKey = keyIsBeforeCurrentEntry;
                            sortDirection = descending;
                        }
                        set.sort(sortDirection);
                        setEnds.sort(sortDirection);
                    };

                    c._addAlgorithm(function (cursor, advance, resolve) {
                        var key = cursor.key;
                        while (checkKey(key)) {
                            // The cursor has passed beyond this key. Check next.
                            ++i;
                            if (i === set.length) {
                                // There is no next. Stop searching.
                                advance(resolve);
                                return false;
                            }
                        }
                        if (key >= set[i] && key <= setEnds[i]) {
                            // The current cursor value should be included and we should continue a single step in case next item has the same key or possibly our next key in set.
                            advance(function () { cursor.continue(); });
                            return true;
                        } else {
                            // cursor.key not yet at set[i]. Forward cursor to the next key to hunt for.
                            advance(function() {
                                if (sortDirection === ascending) cursor.continue(set[i]);
                                else cursor.continue(setEnds[i]);
                            });
                            return false;
                        }
                    });
                    return c;
                }
            };
        });




        //
        //
        //
        // Collection Class
        //
        //
        //
        function Collection(whereClause, keyRangeGenerator) {
            /// <summary>
            /// 
            /// </summary>
            /// <param name="whereClause" type="WhereClause">Where clause instance</param>
            /// <param name="keyRangeGenerator" value="function(){ return IDBKeyRange.bound(0,1);}" optional="true"></param>
            var keyRange = null, error = null;
            if (keyRangeGenerator) try {
                keyRange = keyRangeGenerator();
            } catch (ex) {
                error = ex;
            }

            var whereCtx = whereClause._ctx;
            this._ctx = {
                table: whereCtx.table,
                index: whereCtx.index,
                isPrimKey: (!whereCtx.index || (whereCtx.table.schema.primKey.keyPath && whereCtx.index === whereCtx.table.schema.primKey.name)),
                range: keyRange,
                op: "openCursor",
                dir: "next",
                unique: "",
                algorithm: null,
                filter: null,
                isMatch: null,
                offset: 0,
                limit: Infinity,
                error: error, // If set, any promise must be rejected with this error
                or: whereCtx.or
            };
        }

        extend(Collection.prototype, function () {

            //
            // Collection Private Functions
            //

            function addFilter(ctx, fn) {
                ctx.filter = combine(ctx.filter, fn);
            }

            function addMatchFilter(ctx, fn) {
                ctx.isMatch = combine(ctx.isMatch, fn);
            }

            function getIndexOrStore(ctx, store) {
                if (ctx.isPrimKey) return store;
                var indexSpec = ctx.table.schema.idxByName[ctx.index];
                if (!indexSpec) throw new Error("KeyPath " + ctx.index + " on object store " + store.name + " is not indexed");
                return ctx.isPrimKey ? store : store.index(indexSpec.name);
            }

            function openCursor(ctx, store) {
                return getIndexOrStore(ctx, store)[ctx.op](ctx.range || null, ctx.dir + ctx.unique);
            }

            function iter(ctx, fn, resolve, reject, idbstore) {
                if (!ctx.or) {
                    iterate(openCursor(ctx, idbstore), combine(ctx.algorithm, ctx.filter), fn, resolve, reject, ctx.table.hook.reading.fire);
                } else {
                    (function () {
                        var filter = ctx.filter;
                        var set = {};
                        var primKey = ctx.table.schema.primKey.keyPath;
                        var resolved = 0;

                        function resolveboth() {
                            if (++resolved === 2) resolve(); // Seems like we just support or btwn max 2 expressions, but there are no limit because we do recursion.
                        }

                        function union(item, cursor, advance) {
                            if (!filter || filter(cursor, advance, resolveboth, reject)) {
                                var key = cursor.primaryKey.toString(); // Converts any Date to String, String to String, Number to String and Array to comma-separated string
                                if (!set.hasOwnProperty(key)) {
                                    set[key] = true;
                                    fn(item, cursor, advance);
                                }
                            }
                        }

                        ctx.or._iterate(union, resolveboth, reject, idbstore);
                        iterate(openCursor(ctx, idbstore), ctx.algorithm, union, resolveboth, reject, ctx.table.hook.reading.fire);
                    })();
                }
            }
            function getInstanceTemplate(ctx) {
                return ctx.table.schema.instanceTemplate;
            }


            return {

                //
                // Collection Protected Functions
                //

                _read: function (fn, cb) {
                    var ctx = this._ctx;
                    if (ctx.error)
                        return ctx.table._trans(null, function rejector(resolve, reject) { reject(ctx.error); });
                    else
                        return ctx.table._idbstore(READONLY, fn).then(cb);
                },
                _write: function (fn) {
                    var ctx = this._ctx;
                    if (ctx.error)
                        return ctx.table._trans(null, function rejector(resolve, reject) { reject(ctx.error); });
                    else
                        return ctx.table._idbstore(READWRITE, fn, "locked"); // When doing write operations on collections, always lock the operation so that upcoming operations gets queued.
                },
                _addAlgorithm: function (fn) {
                    var ctx = this._ctx;
                    ctx.algorithm = combine(ctx.algorithm, fn);
                },

                _iterate: function (fn, resolve, reject, idbstore) {
                    return iter(this._ctx, fn, resolve, reject, idbstore);
                },

                //
                // Collection Public methods
                //

                each: function (fn) {
                    var ctx = this._ctx;

                    fake && fn(getInstanceTemplate(ctx));

                    return this._read(function (resolve, reject, idbstore) {
                        iter(ctx, fn, resolve, reject, idbstore);
                    });
                },

                count: function (cb) {
                    if (fake) return Promise.resolve(0).then(cb);
                    var self = this,
                        ctx = this._ctx;

                    if (ctx.filter || ctx.algorithm || ctx.or) {
                        // When filters are applied or 'ored' collections are used, we must count manually
                        var count = 0;
                        return this._read(function (resolve, reject, idbstore) {
                            iter(ctx, function () { ++count; return false; }, function () { resolve(count); }, reject, idbstore);
                        }, cb);
                    } else {
                        // Otherwise, we can use the count() method if the index.
                        return this._read(function (resolve, reject, idbstore) {
                            var idx = getIndexOrStore(ctx, idbstore);
                            var req = (ctx.range ? idx.count(ctx.range) : idx.count());
                            req.onerror = eventRejectHandler(reject, ["calling", "count()", "on", self.name]);
                            req.onsuccess = function (e) {
                                resolve(Math.min(e.target.result, Math.max(0, ctx.limit - ctx.offset)));
                            };
                        }, cb);
                    }
                },

                sortBy: function (keyPath, cb) {
                    /// <param name="keyPath" type="String"></param>
                    var ctx = this._ctx;
                    var parts = keyPath.split('.').reverse(),
                        lastPart = parts[0],
                        lastIndex = parts.length - 1;
                    function getval(obj, i) {
                        if (i) return getval(obj[parts[i]], i - 1);
                        return obj[lastPart];
                    }
                    var order = this._ctx.dir === "next" ? 1 : -1;

                    function sorter(a, b) {
                        var aVal = getval(a, lastIndex),
                            bVal = getval(b, lastIndex);
                        return aVal < bVal ? -order : aVal > bVal ? order : 0;
                    }
                    return this.toArray(function (a) {
                        return a.sort(sorter);
                    }).then(cb);
                },

                toArray: function (cb) {
                    var ctx = this._ctx;
                    return this._read(function (resolve, reject, idbstore) {
                        fake && resolve([getInstanceTemplate(ctx)]);
                        var a = [];
                        iter(ctx, function (item) { a.push(item); }, function arrayComplete() {
                            resolve(a);
                        }, reject, idbstore);
                    }, cb);
                },

                offset: function (offset) {
                    var ctx = this._ctx;
                    if (offset <= 0) return this;
                    ctx.offset += offset; // For count()
                    if (!ctx.or && !ctx.algorithm && !ctx.filter) {
                        addFilter(ctx, function offsetFilter(cursor, advance, resolve) {
                            if (offset === 0) return true;
                            if (offset === 1) { --offset; return false; }
                            advance(function () { cursor.advance(offset); offset = 0; });
                            return false;
                        });
                    } else {
                        addFilter(ctx, function offsetFilter(cursor, advance, resolve) {
                            return (--offset < 0);
                        });
                    }
                    return this;
                },

                limit: function (numRows) {
                    this._ctx.limit = Math.min(this._ctx.limit, numRows); // For count()
                    addFilter(this._ctx, function (cursor, advance, resolve) {
                        if (--numRows <= 0) advance(resolve); // Stop after this item has been included
                        return numRows >= 0; // If numRows is already below 0, return false because then 0 was passed to numRows initially. Otherwise we wouldnt come here.
                    });
                    return this;
                },

                until: function (filterFunction, bIncludeStopEntry) {
                    var ctx = this._ctx;
                    fake && filterFunction(getInstanceTemplate(ctx));
                    addFilter(this._ctx, function (cursor, advance, resolve) {
                        if (filterFunction(cursor.value)) {
                            advance(resolve);
                            return bIncludeStopEntry;
                        } else {
                            return true;
                        }
                    });
                    return this;
                },

                first: function (cb) {
                    return this.limit(1).toArray(function (a) { return a[0]; }).then(cb);
                },

                last: function (cb) {
                    return this.reverse().first(cb);
                },

                and: function (filterFunction) {
                    /// <param name="jsFunctionFilter" type="Function">function(val){return true/false}</param>
                    fake && filterFunction(getInstanceTemplate(this._ctx));
                    addFilter(this._ctx, function (cursor) {
                        return filterFunction(cursor.value);
                    });
                    addMatchFilter(this._ctx, filterFunction); // match filters not used in Dexie.js but can be used by 3rd part libraries to test a collection for a match without querying DB. Used by Dexie.Observable.
                    return this;
                },

                or: function (indexName) {
                    return new WhereClause(this._ctx.table, indexName, this);
                },

                reverse: function () {
                    this._ctx.dir = (this._ctx.dir === "prev" ? "next" : "prev");
                    if (this._ondirectionchange) this._ondirectionchange(this._ctx.dir);
                    return this;
                },

                desc: function () {
                    return this.reverse();
                },

                eachKey: function (cb) {
                    var ctx = this._ctx;
                    fake && cb(getByKeyPath(getInstanceTemplate(this._ctx), this._ctx.index ? this._ctx.table.schema.idxByName[this._ctx.index].keyPath : this._ctx.table.schema.primKey.keyPath));
                    if (!ctx.isPrimKey) ctx.op = "openKeyCursor"; // Need the check because IDBObjectStore does not have "openKeyCursor()" while IDBIndex has.
                    return this.each(function (val, cursor) { cb(cursor.key, cursor); });
                },

                eachUniqueKey: function (cb) {
                    this._ctx.unique = "unique";
                    return this.eachKey(cb);
                },

                keys: function (cb) {
                    var ctx = this._ctx;
                    if (!ctx.isPrimKey) ctx.op = "openKeyCursor"; // Need the check because IDBObjectStore does not have "openKeyCursor()" while IDBIndex has.
                    var a = [];
                    if (fake) return new Promise(this.eachKey.bind(this)).then(function(x) { return [x]; }).then(cb);
                    return this.each(function (item, cursor) {
                        a.push(cursor.key);
                    }).then(function () {
                        return a;
                    }).then(cb);
                },

                uniqueKeys: function (cb) {
                    this._ctx.unique = "unique";
                    return this.keys(cb);
                },

                firstKey: function (cb) {
                    return this.limit(1).keys(function (a) { return a[0]; }).then(cb);
                },

                lastKey: function (cb) {
                    return this.reverse().firstKey(cb);
                },


                distinct: function () {
                    var set = {};
                    addFilter(this._ctx, function (cursor) {
                        var strKey = cursor.primaryKey.toString(); // Converts any Date to String, String to String, Number to String and Array to comma-separated string
                        var found = set.hasOwnProperty(strKey);
                        set[strKey] = true;
                        return !found;
                    });
                    return this;
                }
            };
        });

        //
        //
        // WriteableCollection Class
        //
        //
        function WriteableCollection() {
            Collection.apply(this, arguments);
        }

        derive(WriteableCollection).from(Collection).extend({

            //
            // WriteableCollection Public Methods
            //

            modify: function (changes) {
                var self = this,
                    ctx = this._ctx,
                    hook = ctx.table.hook,
                    updatingHook = hook.updating.fire,
                    deletingHook = hook.deleting.fire;

                fake && typeof changes === 'function' && changes.call({ value: ctx.table.schema.instanceTemplate }, ctx.table.schema.instanceTemplate);

                return this._write(function (resolve, reject, idbstore, trans) {
                    var modifyer;
                    if (typeof changes === 'function') {
                        // Changes is a function that may update, add or delete propterties or even require a deletion the object itself (delete this.item)
                        if (updatingHook === nop && deletingHook === nop) {
                            // Noone cares about what is being changed. Just let the modifier function be the given argument as is.
                            modifyer = changes;
                        } else {
                            // People want to know exactly what is being modified or deleted.
                            // Let modifyer be a proxy function that finds out what changes the caller is actually doing
                            // and call the hooks accordingly!
                            modifyer = function (item) {
                                var origItem = deepClone(item); // Clone the item first so we can compare laters.
                                if (changes.call(this, item) === false) return false; // Call the real modifyer function (If it returns false explicitely, it means it dont want to modify anyting on this object)
                                if (!this.hasOwnProperty("value")) {
                                    // The real modifyer function requests a deletion of the object. Inform the deletingHook that a deletion is taking place.
                                    deletingHook.call(this, this.primKey, item, trans);
                                } else {
                                    // No deletion. Check what was changed
                                    var objectDiff = getObjectDiff(origItem, this.value);
                                    var additionalChanges = updatingHook.call(this, objectDiff, this.primKey, origItem, trans);
                                    if (additionalChanges) {
                                        // Hook want to apply additional modifications. Make sure to fullfill the will of the hook.
                                        item = this.value;
                                        Object.keys(additionalChanges).forEach(function (keyPath) {
                                            setByKeyPath(item, keyPath, additionalChanges[keyPath]);  // Adding {keyPath: undefined} means that the keyPath should be deleted. Handled by setByKeyPath
                                        });
                                    }
                                }
                            }; 
                        }
                    } else if (updatingHook === nop) {
                        // changes is a set of {keyPath: value} and no one is listening to the updating hook.
                        var keyPaths = Object.keys(changes);
                        var numKeys = keyPaths.length;
                        modifyer = function (item) {
                            var anythingModified = false;
                            for (var i = 0; i < numKeys; ++i) {
                                var keyPath = keyPaths[i], val = changes[keyPath];
                                if (getByKeyPath(item, keyPath) !== val) {
                                    setByKeyPath(item, keyPath, val); // Adding {keyPath: undefined} means that the keyPath should be deleted. Handled by setByKeyPath
                                    anythingModified = true;
                                }
                            }
                            return anythingModified;
                        }; 
                    } else {
                        // changes is a set of {keyPath: value} and people are listening to the updating hook so we need to call it and
                        // allow it to add additional modifications to make.
                        var origChanges = changes;
                        changes = shallowClone(origChanges); // Let's work with a clone of the changes keyPath/value set so that we can restore it in case a hook extends it.
                        modifyer = function (item) {
                            var anythingModified = false;
                            var additionalChanges = updatingHook.call(this, changes, this.primKey, deepClone(item), trans);
                            if (additionalChanges) extend(changes, additionalChanges);
                            Object.keys(changes).forEach(function (keyPath) {
                                var val = changes[keyPath];
                                if (getByKeyPath(item, keyPath) !== val) {
                                    setByKeyPath(item, keyPath, val);
                                    anythingModified = true;
                                }
                            });
                            if (additionalChanges) changes = shallowClone(origChanges); // Restore original changes for next iteration
                            return anythingModified;
                        }; 
                    }

                    var count = 0;
                    var successCount = 0;
                    var iterationComplete = false;
                    var failures = [];
                    var failKeys = [];
                    var currentKey = null;

                    function modifyItem(item, cursor, advance) {
                        currentKey = cursor.primaryKey;
                        var thisContext = { primKey: cursor.primaryKey, value: item };
                        if (modifyer.call(thisContext, item) !== false) { // If a callback explicitely returns false, do not perform the update!
                            var bDelete = !thisContext.hasOwnProperty("value");
                            var req = (bDelete ? cursor.delete() : cursor.update(thisContext.value));
                            ++count;
                            req.onerror = eventRejectHandler(function (e) {
                                failures.push(e);
                                failKeys.push(thisContext.primKey);
                                if (thisContext.onerror) thisContext.onerror(e);
                                checkFinished();
                                return true; // Catch these errors and let a final rejection decide whether or not to abort entire transaction
                            }, bDelete ? ["deleting", item, "from", ctx.table.name] : ["modifying", item, "on", ctx.table.name]);
                            req.onsuccess = function (ev) {
                                if (thisContext.onsuccess) thisContext.onsuccess(thisContext.value);
                                ++successCount;
                                checkFinished();
                            }; 
                        } else if (thisContext.onsuccess) {
                            // Hook will expect either onerror or onsuccess to always be called!
                            thisContext.onsuccess(thisContext.value);
                        }
                    }

                    function doReject(e) {
                        if (e) {
                            failures.push(e);
                            failKeys.push(currentKey);
                        }
                        return reject(new ModifyError("Error modifying one or more objects", failures, successCount, failKeys));
                    }

                    function checkFinished() {
                        if (iterationComplete && successCount + failures.length === count) {
                            if (failures.length > 0)
                                doReject();
                            else
                                resolve(successCount);
                        }
                    }
                    self._iterate(modifyItem, function () {
                        iterationComplete = true;
                        checkFinished();
                    }, doReject, idbstore);
                });
            },

            'delete': function () {
                return this.modify(function () { delete this.value; });
            }
        });


        //
        //
        //
        // ------------------------- Help functions ---------------------------
        //
        //
        //

        function lowerVersionFirst(a, b) {
            return a._cfg.version - b._cfg.version;
        }

        function setApiOnPlace(objs, transactionPromiseFactory, tableNames, mode, dbschema, enableProhibitedDB) {
            tableNames.forEach(function (tableName) {
                var tableInstance = db._tableFactory(mode, dbschema[tableName], transactionPromiseFactory);
                objs.forEach(function (obj) {
                    if (!obj[tableName]) {
                        if (enableProhibitedDB) {
                            Object.defineProperty(obj, tableName, {
                                configurable: true,
                                enumerable: true,
                                get: function () {
									var currentTrans = Promise.PSD && Promise.PSD.trans;
                                    if (currentTrans && currentTrans.db === db) {
                                        return currentTrans.tables[tableName];
                                    }
                                    return tableInstance;
                                }
                            });
                        } else {
                            obj[tableName] = tableInstance;
                        }
                    }
                });
            });
        }

        function removeTablesApi(objs) {
            objs.forEach(function (obj) {
                for (var key in obj) {
                    if (obj[key] instanceof Table) delete obj[key];
                }
            });
        }

        function iterate(req, filter, fn, resolve, reject, readingHook) {
            var psd = Promise.PSD;
            readingHook = readingHook || mirror;
            if (!req.onerror) req.onerror = eventRejectHandler(reject);
            if (filter) {
                req.onsuccess = trycatch(function filter_record(e) {
                    var cursor = req.result;
                    if (cursor) {
                        var c = function () { cursor.continue(); };
                        if (filter(cursor, function (advancer) { c = advancer; }, resolve, reject))
                            fn(readingHook(cursor.value), cursor, function (advancer) { c = advancer; });
                        c();
                    } else {
                        resolve();
                    }
                }, reject, psd);
            } else {
                req.onsuccess = trycatch(function filter_record(e) {
                    var cursor = req.result;
                    if (cursor) {
                        var c = function () { cursor.continue(); };
                        fn(readingHook(cursor.value), cursor, function (advancer) { c = advancer; });
                        c();
                    } else {
                        resolve();
                    }
                }, reject, psd);
            }
        }

        function parseIndexSyntax(indexes) {
            /// <param name="indexes" type="String"></param>
            /// <returns type="Array" elementType="IndexSpec"></returns>
            var rv = [];
            indexes.split(',').forEach(function (index) {
                index = index.trim();
                var name = index.replace("&", "").replace("++", "").replace("*", "");
                var keyPath = (name.indexOf('[') !== 0 ? name : index.substring(index.indexOf('[') + 1, index.indexOf(']')).split('+'));

                rv.push(new IndexSpec(
                    name,
                    keyPath || null,
                    index.indexOf('&') !== -1,
                    index.indexOf('*') !== -1,
                    index.indexOf("++") !== -1,
                    Array.isArray(keyPath),
                    keyPath.indexOf('.') !== -1
                ));
            });
            return rv;
        }

        function ascending(a, b) {
            return a < b ? -1 : a > b ? 1 : 0;
        }

        function descending(a, b) {
            return a < b ? 1 : a > b ? -1 : 0;
        }

        function compoundCompare(itemCompare) {
            return function (a, b) {
                var i = 0;
                while (true) {
                    var result = itemCompare(a[i], b[i]);
                    if (result !== 0) return result;
                    ++i;
                    if (i === a.length || i === b.length)
                        return itemCompare(a.length, b.length);
                }
            };
        }

        function combine(filter1, filter2) {
            return filter1 ? filter2 ? function () { return filter1.apply(this, arguments) && filter2.apply(this, arguments); } : filter1 : filter2;
        }

        function hasIEDeleteObjectStoreBug() {
            // Assume bug is present in IE10 and IE11 but dont expect it in next version of IE (IE12)
            return navigator.userAgent.indexOf("Trident") >= 0 || navigator.userAgent.indexOf("MSIE") >= 0;
        }

        function readGlobalSchema() {
            db.verno = idbdb.version / 10;
            db._dbSchema = globalSchema = {};
            dbStoreNames = [].slice.call(idbdb.objectStoreNames, 0);
            if (dbStoreNames.length === 0) return; // Database contains no stores.
            var trans = idbdb.transaction(safariMultiStoreFix(dbStoreNames), 'readonly');
            dbStoreNames.forEach(function (storeName) {
                var store = trans.objectStore(storeName),
                    keyPath = store.keyPath,
                    dotted = keyPath && typeof keyPath === 'string' && keyPath.indexOf('.') !== -1;
                var primKey = new IndexSpec(keyPath, keyPath || "", false, false, !!store.autoIncrement, keyPath && typeof keyPath !== 'string', dotted);
                var indexes = [];
                for (var j = 0; j < store.indexNames.length; ++j) {
                    var idbindex = store.index(store.indexNames[j]);
                    keyPath = idbindex.keyPath;
                    dotted = keyPath && typeof keyPath === 'string' && keyPath.indexOf('.') !== -1;
                    var index = new IndexSpec(idbindex.name, keyPath, !!idbindex.unique, !!idbindex.multiEntry, false, keyPath && typeof keyPath !== 'string', dotted);
                    indexes.push(index);
                }
                globalSchema[storeName] = new TableSchema(storeName, primKey, indexes, {});
            });
            setApiOnPlace([allTables], db._transPromiseFactory, Object.keys(globalSchema), READWRITE, globalSchema);
        }

        function adjustToExistingIndexNames(schema, idbtrans) {
            /// <summary>
            /// Issue #30 Problem with existing db - adjust to existing index names when migrating from non-dexie db
            /// </summary>
            /// <param name="schema" type="Object">Map between name and TableSchema</param>
            /// <param name="idbtrans" type="IDBTransaction"></param>
            var storeNames = idbtrans.db.objectStoreNames;
            for (var i = 0; i < storeNames.length; ++i) {
                var storeName = storeNames[i];
                var store = idbtrans.objectStore(storeName);
                for (var j = 0; j < store.indexNames.length; ++j) {
                    var indexName = store.indexNames[j];
                    var keyPath = store.index(indexName).keyPath;
                    var dexieName = typeof keyPath === 'string' ? keyPath : "[" + [].slice.call(keyPath).join('+') + "]";
                    if (schema[storeName]) {
                        var indexSpec = schema[storeName].idxByName[dexieName];
                        if (indexSpec) indexSpec.name = indexName;
                    }
                }
            }
        }

        extend(this, {
            Collection: Collection,
            Table: Table,
            Transaction: Transaction,
            Version: Version,
            WhereClause: WhereClause,
            WriteableCollection: WriteableCollection,
            WriteableTable: WriteableTable
        });

        init();

        addons.forEach(function (fn) {
            fn(db);
        });
    }

    //
    // Promise Class
    //
    // A variant of promise-light (https://github.com/taylorhakes/promise-light) by https://github.com/taylorhakes - an A+ and ECMASCRIPT 6 compliant Promise implementation.
    //
    // Modified by David Fahlander to be indexedDB compliant (See discussion: https://github.com/promises-aplus/promises-spec/issues/45) .
    // This implementation will not use setTimeout or setImmediate when it's not needed. The behavior is 100% Promise/A+ compliant since
    // the caller of new Promise() can be certain that the promise wont be triggered the lines after constructing the promise. We fix this by using the member variable constructing to check
    // whether the object is being constructed when reject or resolve is called. If so, the use setTimeout/setImmediate to fulfill the promise, otherwise, we know that it's not needed.
    //
    // This topic was also discussed in the following thread: https://github.com/promises-aplus/promises-spec/issues/45 and this implementation solves that issue.
    //
    // Another feature with this Promise implementation is that reject will return false in case no one catched the reject call. This is used
    // to stopPropagation() on the IDBRequest error event in case it was catched but not otherwise.
    //
    // Also, the event new Promise().onuncatched is called in case no one catches a reject call. This is used for us to manually bubble any request
    // errors to the transaction. We must not rely on IndexedDB implementation to do this, because it only does so when the source of the rejection
    // is an error event on a request, not in case an ordinary exception is thrown.
    var Promise = (function () {

        // The use of asap in handle() is remarked because we must NOT use setTimeout(fn,0) because it causes premature commit of indexedDB transactions - which is according to indexedDB specification.
        var _slice = [].slice;
        var _asap = typeof setImmediate === 'undefined' ? function(fn, arg1, arg2, argN) {
            var args = arguments;
            setTimeout(function() { fn.apply(global, _slice.call(args, 1)); }, 0); // If not FF13 and earlier failed, we could use this call here instead: setTimeout.call(this, [fn, 0].concat(arguments));
        } : setImmediate; // IE10+ and node.

        doFakeAutoComplete(function () {
            // Simplify the job for VS Intellisense. This piece of code is one of the keys to the new marvellous intellisense support in Dexie.
            _asap = asap = enqueueImmediate = function(fn) {
                var args = arguments; setTimeout(function() { fn.apply(global, _slice.call(args, 1)); }, 0);
            };
        });

        var asap = _asap,
            isRootExecution = true;

        var operationsQueue = [];
        var tickFinalizers = [];
        function enqueueImmediate(fn, args) {
            operationsQueue.push([fn, _slice.call(arguments, 1)]);
        }

        function executeOperationsQueue() {
            var queue = operationsQueue;
            operationsQueue = [];
            for (var i = 0, l = queue.length; i < l; ++i) {
                var item = queue[i];
                item[0].apply(global, item[1]);
            }
        }

        //var PromiseID = 0;
        function Promise(fn) {
            if (typeof this !== 'object') throw new TypeError('Promises must be constructed via new');
            if (typeof fn !== 'function') throw new TypeError('not a function');
            this._state = null; // null (=pending), false (=rejected) or true (=resolved)
            this._value = null; // error or result
            this._deferreds = [];
            this._catched = false; // for onuncatched
            //this._id = ++PromiseID;
            var self = this;
            var constructing = true;
            this._PSD = Promise.PSD;

            try {
                doResolve(this, fn, function (data) {
                    if (constructing)
                        asap(resolve, self, data);
                    else
                        resolve(self, data);
                }, function (reason) {
                    if (constructing) {
                        asap(reject, self, reason);
                        return false;
                    } else {
                        return reject(self, reason);
                    }
                });
            } finally {
                constructing = false;
            }
        }

        function handle(self, deferred) {
            if (self._state === null) {
                self._deferreds.push(deferred);
                return;
            }

            var cb = self._state ? deferred.onFulfilled : deferred.onRejected;
            if (cb === null) {
                // This Deferred doesnt have a listener for the event being triggered (onFulfilled or onReject) so lets forward the event to any eventual listeners on the Promise instance returned by then() or catch()
                return (self._state ? deferred.resolve : deferred.reject)(self._value);
            }
            var ret, isRootExec = isRootExecution;
            isRootExecution = false;
            asap = enqueueImmediate;
            try {
                var outerPSD = Promise.PSD;
                Promise.PSD = self._PSD;
                ret = cb(self._value);
                if (!self._state && (!ret || typeof ret.then !== 'function' || ret._state !== false)) setCatched(self); // Caller did 'return Promise.reject(err);' - don't regard it as catched!
                deferred.resolve(ret);
            } catch (e) {
                var catched = deferred.reject(e);
                if (!catched && self.onuncatched) {
                    try {
                        self.onuncatched(e);
                    } catch (e) {
                    }
                }
            } finally {
                Promise.PSD = outerPSD;
                if (isRootExec) {
                    do {
                        while (operationsQueue.length > 0) executeOperationsQueue();
                        var finalizer = tickFinalizers.pop();
                        if (finalizer) try {finalizer();} catch(e){}
                    } while (tickFinalizers.length > 0 || operationsQueue.length > 0);
                    asap = _asap;
                    isRootExecution = true;
                }
            }
        }

        function _rootExec(fn) {
            var isRootExec = isRootExecution;
            isRootExecution = false;
            asap = enqueueImmediate;
            try {
                fn();
            } finally {
                if (isRootExec) {
                    do {
                        while (operationsQueue.length > 0) executeOperationsQueue();
                        var finalizer = tickFinalizers.pop();
                        if (finalizer) try { finalizer(); } catch (e) { }
                    } while (tickFinalizers.length > 0 || operationsQueue.length > 0);
                    asap = _asap;
                    isRootExecution = true;
                }
            }
        }

        function setCatched(promise) {
            promise._catched = true;
            if (promise._parent) setCatched(promise._parent);
        }

        function resolve(promise, newValue) {
            var outerPSD = Promise.PSD;
            Promise.PSD = promise._PSD;
            try { //Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
                if (newValue === promise) throw new TypeError('A promise cannot be resolved with itself.');
                if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
                    if (typeof newValue.then === 'function') {
                        doResolve(promise, function (resolve, reject) {
                            //newValue instanceof Promise ? newValue._then(resolve, reject) : newValue.then(resolve, reject);
                            newValue.then(resolve, reject);
                        }, function (data) {
                            resolve(promise, data);
                        }, function (reason) {
                            reject(promise, reason);
                        });
                        return;
                    }
                }
                promise._state = true;
                promise._value = newValue;
                finale.call(promise);
            } catch (e) { reject(e); } finally {
                Promise.PSD = outerPSD;
            }
        }

        function reject(promise, newValue) {
            var outerPSD = Promise.PSD;
            Promise.PSD = promise._PSD;
            promise._state = false;
            promise._value = newValue;

            finale.call(promise);
            if (!promise._catched) {
                try {
                    if (promise.onuncatched)
                        promise.onuncatched(promise._value);
                    Promise.on.error.fire(promise._value);
                } catch (e) {
                }
            }
            Promise.PSD = outerPSD;
            return promise._catched;
        }

        function finale() {
            for (var i = 0, len = this._deferreds.length; i < len; i++) {
                handle(this, this._deferreds[i]);
            }
            this._deferreds = [];
        }

        function Deferred(onFulfilled, onRejected, resolve, reject) {
            this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
            this.onRejected = typeof onRejected === 'function' ? onRejected : null;
            this.resolve = resolve;
            this.reject = reject;
        }

        /**
         * Take a potentially misbehaving resolver function and make sure
         * onFulfilled and onRejected are only called once.
         *
         * Makes no guarantees about asynchrony.
         */
        function doResolve(promise, fn, onFulfilled, onRejected) {
            var done = false;
            try {
                fn(function Promise_resolve(value) {
                    if (done) return;
                    done = true;
                    onFulfilled(value);
                }, function Promise_reject(reason) {
                    if (done) return promise._catched;
                    done = true;
                    return onRejected(reason);
                });
            } catch (ex) {
                if (done) return;
                return onRejected(ex);
            }
        }

        Promise.on = events(null, "error");

        Promise.all = function () {
            var args = Array.prototype.slice.call(arguments.length === 1 && Array.isArray(arguments[0]) ? arguments[0] : arguments);

            return new Promise(function (resolve, reject) {
                if (args.length === 0) return resolve([]);
                var remaining = args.length;
                function res(i, val) {
                    try {
                        if (val && (typeof val === 'object' || typeof val === 'function')) {
                            var then = val.then;
                            if (typeof then === 'function') {
                                then.call(val, function (val) { res(i, val); }, reject);
                                return;
                            }
                        }
                        args[i] = val;
                        if (--remaining === 0) {
                            resolve(args);
                        }
                    } catch (ex) {
                        reject(ex);
                    }
                }
                for (var i = 0; i < args.length; i++) {
                    res(i, args[i]);
                }
            });
        };

        /* Prototype Methods */
        Promise.prototype.then = function (onFulfilled, onRejected) {
            var self = this;
            var p = new Promise(function (resolve, reject) {
                if (self._state === null)
                    handle(self, new Deferred(onFulfilled, onRejected, resolve, reject));
                else
                    asap(handle, self, new Deferred(onFulfilled, onRejected, resolve, reject));
            });
            p._PSD = this._PSD;
            p.onuncatched = this.onuncatched; // Needed when exception occurs in a then() clause of a successful parent promise. Want onuncatched to be called even in callbacks of callbacks of the original promise.
            p._parent = this; // Used for recursively calling onuncatched event on self and all parents.
            return p;
        };

        Promise.prototype._then = function (onFulfilled, onRejected) {
            handle(this, new Deferred(onFulfilled, onRejected, nop,nop));
        };

        Promise.prototype['catch'] = function (onRejected) {
            if (arguments.length === 1) return this.then(null, onRejected);
            // First argument is the Error type to catch
            var type = arguments[0], callback = arguments[1];
            if (typeof type === 'function') return this.then(null, function (e) {
                // Catching errors by its constructor type (similar to java / c++ / c#)
                // Sample: promise.catch(TypeError, function (e) { ... });
                if (e instanceof type) return callback(e); else return Promise.reject(e);
            });
            else return this.then(null, function (e) {
                // Catching errors by the error.name property. Makes sense for indexedDB where error type
                // is always DOMError but where e.name tells the actual error type.
                // Sample: promise.catch('ConstraintError', function (e) { ... });
                if (e && e.name === type) return callback(e); else return Promise.reject(e);
            });
        };

        Promise.prototype['finally'] = function (onFinally) {
            return this.then(function (value) {
                onFinally();
                return value;
            }, function (err) {
                onFinally();
                return Promise.reject(err);
            });
        };

        Promise.prototype.onuncatched = null; // Optional event triggered if promise is rejected but no one listened.

        Promise.resolve = function (value) {
            var p = new Promise(function () { });
            p._state = true;
            p._value = value;
            return p;
        };

        Promise.reject = function (value) {
            var p = new Promise(function () { });
            p._state = false;
            p._value = value;
            return p;
        };

        Promise.race = function (values) {
            return new Promise(function (resolve, reject) {
                values.map(function (value) {
                    value.then(resolve, reject);
                });
            });
        };

        Promise.PSD = null; // Promise Specific Data - a TLS Pattern (Thread Local Storage) for Promises. TODO: Rename Promise.PSD to Promise.data

        Promise.newPSD = function (fn) {
            // Create new PSD scope (Promise Specific Data)
            var outerScope = Promise.PSD;
            Promise.PSD = outerScope ? Object.create(outerScope) : {};
            try {
                return fn();
            } finally {
                Promise.PSD = outerScope;
            }
        };

        Promise._rootExec = _rootExec;
        Promise._tickFinalize = function(callback) {
            if (isRootExecution) throw new Error("Not in a virtual tick");
            tickFinalizers.push(callback);
        };

        return Promise;
    })();


    //
    //
    // ------ Exportable Help Functions -------
    //
    //

    function nop() { }
    function mirror(val) { return val; }

    function pureFunctionChain(f1, f2) {
        // Enables chained events that takes ONE argument and returns it to the next function in chain.
        // This pattern is used in the hook("reading") event.
        if (f1 === mirror) return f2;
        return function (val) {
            return f2(f1(val));
        }; 
    }

    function callBoth(on1, on2) {
        return function () {
            on1.apply(this, arguments);
            on2.apply(this, arguments);
        }; 
    }

    function hookCreatingChain(f1, f2) {
        // Enables chained events that takes several arguments and may modify first argument by making a modification and then returning the same instance.
        // This pattern is used in the hook("creating") event.
        if (f1 === nop) return f2;
        return function () {
            var res = f1.apply(this, arguments);
            if (res !== undefined) arguments[0] = res;
            var onsuccess = this.onsuccess, // In case event listener has set this.onsuccess
                onerror = this.onerror;     // In case event listener has set this.onerror
            delete this.onsuccess;
            delete this.onerror;
            var res2 = f2.apply(this, arguments);
            if (onsuccess) this.onsuccess = this.onsuccess ? callBoth(onsuccess, this.onsuccess) : onsuccess;
            if (onerror) this.onerror = this.onerror ? callBoth(onerror, this.onerror) : onerror;
            return res2 !== undefined ? res2 : res;
        }; 
    }

    function hookUpdatingChain(f1, f2) {
        if (f1 === nop) return f2;
        return function () {
            var res = f1.apply(this, arguments);
            if (res !== undefined) extend(arguments[0], res); // If f1 returns new modifications, extend caller's modifications with the result before calling next in chain.
            var onsuccess = this.onsuccess, // In case event listener has set this.onsuccess
                onerror = this.onerror;     // In case event listener has set this.onerror
            delete this.onsuccess;
            delete this.onerror;
            var res2 = f2.apply(this, arguments);
            if (onsuccess) this.onsuccess = this.onsuccess ? callBoth(onsuccess, this.onsuccess) : onsuccess;
            if (onerror) this.onerror = this.onerror ? callBoth(onerror, this.onerror) : onerror;
            return res === undefined ?
                (res2 === undefined ? undefined : res2) :
                (res2 === undefined ? res : extend(res, res2));
        }; 
    }

    function stoppableEventChain(f1, f2) {
        // Enables chained events that may return false to stop the event chain.
        if (f1 === nop) return f2;
        return function () {
            if (f1.apply(this, arguments) === false) return false;
            return f2.apply(this, arguments);
        }; 
    }

    function reverseStoppableEventChain(f1, f2) {
        if (f1 === nop) return f2;
        return function () {
            if (f2.apply(this, arguments) === false) return false;
            return f1.apply(this, arguments);
        }; 
    }

    function nonStoppableEventChain(f1, f2) {
        if (f1 === nop) return f2;
        return function () {
            f1.apply(this, arguments);
            f2.apply(this, arguments);
        }; 
    }

    function promisableChain(f1, f2) {
        if (f1 === nop) return f2;
        return function () {
            var res = f1.apply(this, arguments);
            if (res && typeof res.then === 'function') {
                var thiz = this, args = arguments;
                return res.then(function () {
                    return f2.apply(thiz, args);
                });
            }
            return f2.apply(this, arguments);
        }; 
    }

    function events(ctx, eventNames) {
        var args = arguments;
        var evs = {};
        var rv = function (eventName, subscriber) {
            if (subscriber) {
                // Subscribe
                var args = [].slice.call(arguments, 1);
                var ev = evs[eventName];
                ev.subscribe.apply(ev, args);
                return ctx;
            } else if (typeof (eventName) === 'string') {
                // Return interface allowing to fire or unsubscribe from event
                return evs[eventName];
            }
        }; 
        rv.addEventType = add;

        function add(eventName, chainFunction, defaultFunction) {
            if (Array.isArray(eventName)) return addEventGroup(eventName);
            if (typeof eventName === 'object') return addConfiguredEvents(eventName);
            if (!chainFunction) chainFunction = stoppableEventChain;
            if (!defaultFunction) defaultFunction = nop;

            var context = {
                subscribers: [],
                fire: defaultFunction,
                subscribe: function (cb) {
                    context.subscribers.push(cb);
                    context.fire = chainFunction(context.fire, cb);
                },
                unsubscribe: function (cb) {
                    context.subscribers = context.subscribers.filter(function (fn) { return fn !== cb; });
                    context.fire = context.subscribers.reduce(chainFunction, defaultFunction);
                }
            };
            evs[eventName] = rv[eventName] = context;
            return context;
        }

        function addConfiguredEvents(cfg) {
            // events(this, {reading: [functionChain, nop]});
            Object.keys(cfg).forEach(function (eventName) {
                var args = cfg[eventName];
                if (Array.isArray(args)) {
                    add(eventName, cfg[eventName][0], cfg[eventName][1]);
                } else if (args === 'asap') {
                    // Rather than approaching event subscription using a functional approach, we here do it in a for-loop where subscriber is executed in its own stack
                    // enabling that any exception that occur wont disturb the initiator and also not nescessary be catched and forgotten.
                    var context = add(eventName, null, function fire() {
                        var args = arguments;
                        context.subscribers.forEach(function (fn) {
                            asap(function fireEvent() {
                                fn.apply(global, args);
                            });
                        });
                    });
                    context.subscribe = function (fn) {
                        // Change how subscribe works to not replace the fire function but to just add the subscriber to subscribers
                        if (context.subscribers.indexOf(fn) === -1)
                            context.subscribers.push(fn);
                    }; 
                    context.unsubscribe = function (fn) {
                        // Change how unsubscribe works for the same reason as above.
                        var idxOfFn = context.subscribers.indexOf(fn);
                        if (idxOfFn !== -1) context.subscribers.splice(idxOfFn, 1);
                    }; 
                } else throw new Error("Invalid event config");
            });
        }

        function addEventGroup(eventGroup) {
            // promise-based event group (i.e. we promise to call one and only one of the events in the pair, and to only call it once.
            var done = false;
            eventGroup.forEach(function (name) {
                add(name).subscribe(checkDone);
            });
            function checkDone() {
                if (done) return false;
                done = true;
            }
        }

        for (var i = 1, l = args.length; i < l; ++i) {
            add(args[i]);
        }

        return rv;
    }

    function assert(b) {
        if (!b) throw new Error("Assertion failed");
    }

    function asap(fn) {
        if (global.setImmediate) setImmediate(fn); else setTimeout(fn, 0);
    }

    var fakeAutoComplete = function () { };// Will never be changed. We just fake for the IDE that we change it (see doFakeAutoComplete())
    var fake = false; // Will never be changed. We just fake for the IDE that we change it (see doFakeAutoComplete())

    function doFakeAutoComplete(fn) {
        var to = setTimeout(fn, 1000);
        clearTimeout(to);
    }

    function trycatch(fn, reject, psd) {
        return function () {
            var outerPSD = Promise.PSD; // Support Promise-specific data (PSD) in callback calls
            Promise.PSD = psd;
            try {
                fn.apply(this, arguments);
            } catch (e) {
                reject(e);
            } finally {
                Promise.PSD = outerPSD;
            }
        };
    }

    function getByKeyPath(obj, keyPath) {
        // http://www.w3.org/TR/IndexedDB/#steps-for-extracting-a-key-from-a-value-using-a-key-path
        if (obj.hasOwnProperty(keyPath)) return obj[keyPath]; // This line is moved from last to first for optimization purpose.
        if (!keyPath) return obj;
        if (typeof keyPath !== 'string') {
            var rv = [];
            for (var i = 0, l = keyPath.length; i < l; ++i) {
                var val = getByKeyPath(obj, keyPath[i]);
                rv.push(val);
            }
            return rv;
        }
        var period = keyPath.indexOf('.');
        if (period !== -1) {
            var innerObj = obj[keyPath.substr(0, period)];
            return innerObj === undefined ? undefined : getByKeyPath(innerObj, keyPath.substr(period + 1));
        }
        return undefined;
    }

    function setByKeyPath(obj, keyPath, value) {
        if (!obj || keyPath === undefined) return;
        if (typeof keyPath !== 'string' && 'length' in keyPath) {
            assert(typeof value !== 'string' && 'length' in value);
            for (var i = 0, l = keyPath.length; i < l; ++i) {
                setByKeyPath(obj, keyPath[i], value[i]);
            }
        } else {
            var period = keyPath.indexOf('.');
            if (period !== -1) {
                var currentKeyPath = keyPath.substr(0, period);
                var remainingKeyPath = keyPath.substr(period + 1);
                if (remainingKeyPath === "")
                    if (value === undefined) delete obj[currentKeyPath]; else obj[currentKeyPath] = value;
                else {
                    var innerObj = obj[currentKeyPath];
                    if (!innerObj) innerObj = (obj[currentKeyPath] = {});
                    setByKeyPath(innerObj, remainingKeyPath, value);
                }
            } else {
                if (value === undefined) delete obj[keyPath]; else obj[keyPath] = value;
            }
        }
    }

    function delByKeyPath(obj, keyPath) {
        if (typeof keyPath === 'string')
            setByKeyPath(obj, keyPath, undefined);
        else if ('length' in keyPath)
            [].map.call(keyPath, function(kp) {
                 setByKeyPath(obj, kp, undefined);
            });
    }

    function shallowClone(obj) {
        var rv = {};
        for (var m in obj) {
            if (obj.hasOwnProperty(m)) rv[m] = obj[m];
        }
        return rv;
    }

    function deepClone(any) {
        if (!any || typeof any !== 'object') return any;
        var rv;
        if (Array.isArray(any)) {
            rv = [];
            for (var i = 0, l = any.length; i < l; ++i) {
                rv.push(deepClone(any[i]));
            }
        } else if (any instanceof Date) {
            rv = new Date();
            rv.setTime(any.getTime());
        } else {
            rv = any.constructor ? Object.create(any.constructor.prototype) : {};
            for (var prop in any) {
                if (any.hasOwnProperty(prop)) {
                    rv[prop] = deepClone(any[prop]);
                }
            }
        }
        return rv;
    }

    function getObjectDiff(a, b) {
        // This is a simplified version that will always return keypaths on the root level.
        // If for example a and b differs by: (a.somePropsObject.x != b.somePropsObject.x), we will return that "somePropsObject" is changed
        // and not "somePropsObject.x". This is acceptable and true but could be optimized to support nestled changes if that would give a
        // big optimization benefit.
        var rv = {};
        for (var prop in a) if (a.hasOwnProperty(prop)) {
            if (!b.hasOwnProperty(prop))
                rv[prop] = undefined; // Property removed
            else if (a[prop] !== b[prop] && JSON.stringify(a[prop]) != JSON.stringify(b[prop]))
                rv[prop] = b[prop]; // Property changed
        }
        for (var prop in b) if (b.hasOwnProperty(prop) && !a.hasOwnProperty(prop)) {
            rv[prop] = b[prop]; // Property added
        }
        return rv;
    }

    function parseType(type) {
        if (typeof type === 'function') {
            return new type();
        } else if (Array.isArray(type)) {
            return [parseType(type[0])];
        } else if (type && typeof type === 'object') {
            var rv = {};
            applyStructure(rv, type);
            return rv;
        } else {
            return type;
        }
    }

    function applyStructure(obj, structure) {
        Object.keys(structure).forEach(function (member) {
            var value = parseType(structure[member]);
            obj[member] = value;
        });
    }

    function eventRejectHandler(reject, sentance) {
        return function (event) {
            var errObj = (event && event.target.error) || new Error();
            if (sentance) {
                var occurredWhen = " occurred when " + sentance.map(function (word) {
                    switch (typeof (word)) {
                        case 'function': return word();
                        case 'string': return word;
                        default: return JSON.stringify(word);
                    }
                }).join(" ");
                if (errObj.name) {
                    errObj.toString = function toString() {
                        return errObj.name + occurredWhen + (errObj.message ? ". " + errObj.message : "");
                        // Code below works for stacked exceptions, BUT! stack is never present in event errors (not in any of the browsers). So it's no use to include it!
                        /*delete this.toString; // Prohibiting endless recursiveness in IE.
                        if (errObj.stack) rv += (errObj.stack ? ". Stack: " + errObj.stack : "");
                        this.toString = toString;
                        return rv;*/
                    };
                } else {
                    errObj = errObj + occurredWhen;
                }
            };
            reject(errObj);

            if (event) {// Old versions of IndexedDBShim doesnt provide an error event
                // Stop error from propagating to IDBTransaction. Let us handle that manually instead.
                if (event.stopPropagation) // IndexedDBShim doesnt support this
                    event.stopPropagation();
                if (event.preventDefault) // IndexedDBShim doesnt support this
                    event.preventDefault();
            }

            return false;
        };
    }

    function stack(error) {
        try {
            throw error;
        } catch (e) {
            return e;
        }
    }
    function preventDefault(e) {
        e.preventDefault();
    }

    function globalDatabaseList(cb) {
        var val,
            localStorage = Dexie.dependencies.localStorage;
        if (!localStorage) return cb([]); // Envs without localStorage support
        try {
            val = JSON.parse(localStorage.getItem('Dexie.DatabaseNames') || "[]");
        } catch (e) {
            val = [];
        }
        if (cb(val)) {
            localStorage.setItem('Dexie.DatabaseNames', JSON.stringify(val));
        }
    }

    //
    // IndexSpec struct
    //
    function IndexSpec(name, keyPath, unique, multi, auto, compound, dotted) {
        /// <param name="name" type="String"></param>
        /// <param name="keyPath" type="String"></param>
        /// <param name="unique" type="Boolean"></param>
        /// <param name="multi" type="Boolean"></param>
        /// <param name="auto" type="Boolean"></param>
        /// <param name="compound" type="Boolean"></param>
        /// <param name="dotted" type="Boolean"></param>
        this.name = name;
        this.keyPath = keyPath;
        this.unique = unique;
        this.multi = multi;
        this.auto = auto;
        this.compound = compound;
        this.dotted = dotted;
        var keyPathSrc = typeof keyPath === 'string' ? keyPath : keyPath && ('[' + [].join.call(keyPath, '+') + ']');
        this.src = (unique ? '&' : '') + (multi ? '*' : '') + (auto ? "++" : "") + keyPathSrc;
    }

    //
    // TableSchema struct
    //
    function TableSchema(name, primKey, indexes, instanceTemplate) {
        /// <param name="name" type="String"></param>
        /// <param name="primKey" type="IndexSpec"></param>
        /// <param name="indexes" type="Array" elementType="IndexSpec"></param>
        /// <param name="instanceTemplate" type="Object"></param>
        this.name = name;
        this.primKey = primKey || new IndexSpec();
        this.indexes = indexes || [new IndexSpec()];
        this.instanceTemplate = instanceTemplate;
        this.mappedClass = null;
        this.idxByName = indexes.reduce(function (hashSet, index) {
            hashSet[index.name] = index;
            return hashSet;
        }, {});
    }

    //
    // ModifyError Class (extends Error)
    //
    function ModifyError(msg, failures, successCount, failedKeys) {
        this.name = "ModifyError";
        this.failures = failures;
        this.failedKeys = failedKeys;
        this.successCount = successCount;
        this.message = failures.join('\n');
    }
    derive(ModifyError).from(Error);

    //
    // Static delete() method.
    //
    Dexie.delete = function (databaseName) {
        var db = new Dexie(databaseName),
            promise = db.delete();
        promise.onblocked = function (fn) {
            db.on("blocked", fn);
            return this;
        };
        return promise;
    }; 

    //
    // Static method for retrieving a list of all existing databases at current host.
    //
    Dexie.getDatabaseNames = function (cb) {
        return new Promise(function (resolve, reject) {
            var getDatabaseNames = getNativeGetDatabaseNamesFn();
            if (getDatabaseNames) { // In case getDatabaseNames() becomes standard, let's prepare to support it:
                var req = getDatabaseNames();
                req.onsuccess = function (event) {
                    resolve([].slice.call(event.target.result, 0)); // Converst DOMStringList to Array<String>
                }; 
                req.onerror = eventRejectHandler(reject);
            } else {
                globalDatabaseList(function (val) {
                    resolve(val);
                    return false;
                });
            }
        }).then(cb);
    }; 

    Dexie.defineClass = function (structure) {
        /// <summary>
        ///     Create a javascript constructor based on given template for which properties to expect in the class.
        ///     Any property that is a constructor function will act as a type. So {name: String} will be equal to {name: new String()}.
        /// </summary>
        /// <param name="structure">Helps IDE code completion by knowing the members that objects contain and not just the indexes. Also
        /// know what type each member has. Example: {name: String, emailAddresses: [String], properties: {shoeSize: Number}}</param>

        // Default constructor able to copy given properties into this object.
        function Class(properties) {
            /// <param name="properties" type="Object" optional="true">Properties to initialize object with.
            /// </param>
            properties ? extend(this, properties) : fake && applyStructure(this, structure);
        }
        return Class;
    }; 

    Dexie.ignoreTransaction = function (scopeFunc) {
        // In case caller is within a transaction but needs to create a separate transaction.
        // Example of usage:
        // 
        // Let's say we have a logger function in our app. Other application-logic should be unaware of the
        // logger function and not need to include the 'logentries' table in all transaction it performs.
        // The logging should always be done in a separate transaction and not be dependant on the current
        // running transaction context. Then you could use Dexie.ignoreTransaction() to run code that starts a new transaction.
        //
        //     Dexie.ignoreTransaction(function() {
        //         db.logentries.add(newLogEntry);
        //     });
        //
        // Unless using Dexie.ignoreTransaction(), the above example would try to reuse the current transaction
        // in current Promise-scope.
        //
        // An alternative to Dexie.ignoreTransaction() would be setImmediate() or setTimeout(). The reason we still provide an
        // API for this because
        //  1) The intention of writing the statement could be unclear if using setImmediate() or setTimeout().
        //  2) setTimeout() would wait unnescessary until firing. This is however not the case with setImmediate().
        //  3) setImmediate() is not supported in the ES standard.
        return Promise.newPSD(function () {
            Promise.PSD.trans = null;
            return scopeFunc();
        });
    };
    Dexie.spawn = function () {
        if (global.console) console.warn("Dexie.spawn() is deprecated. Use Dexie.ignoreTransaction() instead.");
        return Dexie.ignoreTransaction.apply(this, arguments);
    }

    Dexie.vip = function (fn) {
        // To be used by subscribers to the on('ready') event.
        // This will let caller through to access DB even when it is blocked while the db.ready() subscribers are firing.
        // This would have worked automatically if we were certain that the Provider was using Dexie.Promise for all asyncronic operations. The promise PSD
        // from the provider.connect() call would then be derived all the way to when provider would call localDatabase.applyChanges(). But since
        // the provider more likely is using non-promise async APIs or other thenable implementations, we cannot assume that.
        // Note that this method is only useful for on('ready') subscribers that is returning a Promise from the event. If not using vip()
        // the database could deadlock since it wont open until the returned Promise is resolved, and any non-VIPed operation started by
        // the caller will not resolve until database is opened.
        return Promise.newPSD(function () {
            Promise.PSD.letThrough = true; // Make sure we are let through if still blocking db due to onready is firing.
            return fn();
        });
    }; 

    // Dexie.currentTransaction property. Only applicable for transactions entered using the new "transact()" method.
    Object.defineProperty(Dexie, "currentTransaction", {
        get: function () {
            /// <returns type="Transaction"></returns>
            return Promise.PSD && Promise.PSD.trans || null;
        }
    }); 

    function safariMultiStoreFix(storeNames) {
        return storeNames.length === 1 ? storeNames[0] : storeNames;
    }

    // Export our Promise implementation since it can be handy as a standalone Promise implementation
    Dexie.Promise = Promise;
    // Export our derive/extend/override methodology
    Dexie.derive = derive;
    Dexie.extend = extend;
    Dexie.override = override;
    // Export our events() function - can be handy as a toolkit
    Dexie.events = events;
    Dexie.getByKeyPath = getByKeyPath;
    Dexie.setByKeyPath = setByKeyPath;
    Dexie.delByKeyPath = delByKeyPath;
    Dexie.shallowClone = shallowClone;
    Dexie.deepClone = deepClone;
    Dexie.addons = [];
    Dexie.fakeAutoComplete = fakeAutoComplete;
    Dexie.asap = asap;
    // Export our static classes
    Dexie.ModifyError = ModifyError;
    Dexie.MultiModifyError = ModifyError; // Backward compatibility pre 0.9.8
    Dexie.IndexSpec = IndexSpec;
    Dexie.TableSchema = TableSchema;
    //
    // Dependencies
    //
    // These will automatically work in browsers with indexedDB support, or where an indexedDB polyfill has been included.
    //
    // In node.js, however, these properties must be set "manually" before instansiating a new Dexie(). For node.js, you need to require indexeddb-js or similar and then set these deps.
    //
    var idbshim = global.idbModules && global.idbModules.shimIndexedDB ? global.idbModules : {};
    Dexie.dependencies = {
        // Required:
        // NOTE: The "_"-prefixed versions are for prioritizing IDB-shim on IOS8 before the native IDB in case the shim was included.
        indexedDB: idbshim.shimIndexedDB || global.indexedDB || global.mozIndexedDB || global.webkitIndexedDB || global.msIndexedDB,
        IDBKeyRange: idbshim.IDBKeyRange || global.IDBKeyRange || global.webkitIDBKeyRange,
        IDBTransaction: idbshim.IDBTransaction || global.IDBTransaction || global.webkitIDBTransaction,
        // Optional:
        Error: global.Error || String,
        SyntaxError: global.SyntaxError || String,
        TypeError: global.TypeError || String,
        DOMError: global.DOMError || String,
        localStorage: ((typeof chrome !== "undefined" && chrome !== null ? chrome.storage : void 0) != null ? null : global.localStorage)
    }; 

    // API Version Number: Type Number, make sure to always set a version number that can be comparable correctly. Example: 0.9, 0.91, 0.92, 1.0, 1.01, 1.1, 1.2, 1.21, etc.
    Dexie.version = 1.20;

    function getNativeGetDatabaseNamesFn() {
        var indexedDB = Dexie.dependencies.indexedDB;
        var fn = indexedDB && (indexedDB.getDatabaseNames || indexedDB.webkitGetDatabaseNames);
        return fn && fn.bind(indexedDB);
    }

    // Export Dexie to window or as a module depending on environment.
    publish("Dexie", Dexie);

    // Fool IDE to improve autocomplete. Tested with Visual Studio 2013 and 2015.
    doFakeAutoComplete(function() {
        Dexie.fakeAutoComplete = fakeAutoComplete = doFakeAutoComplete;
        Dexie.fake = fake = true;
    });
}).apply(null,

    // AMD:
    typeof define === 'function' && define.amd ?
    [self || window, function (name, value) { define(function () { return value; }); }] :

    // CommonJS:
    typeof global !== 'undefined' && typeof module !== 'undefined' && module.exports ?
    [global, function (name, value) { module.exports = value; }]

    // Vanilla HTML and WebWorkers:
    : [self || window, function (name, value) { (self || window)[name] = value; }]);


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}]},{},[1])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvanMvYmFja2dyb3VuZC5qcyIsInNyYy9qcy9tb2R1bGVzL2RhdGEuanMiLCIuLi8uLi8uLi9Eb2N1bWVudHMvUHJvZ3JhbW1pbmcvUHJvamVjdHMvVGFnUHJvUmVwbGF5c01pc2MvRGV4aWUvRGV4aWUuanMvZGlzdC9sYXRlc3QvRGV4aWUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUM3SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsInZhciBEYXRhID0gcmVxdWlyZSgnLi9tb2R1bGVzL2RhdGEnKTtcclxuXHJcbi8vIEVuc3VyZSBkYXRhYmFzZSBpcyBub3QgcHJlc2VudC5cclxuRGF0YS5kZWxldGUoKS50aGVuKGZ1bmN0aW9uICgpIHtcclxuICB3aW5kb3cuZGV4aWVJbml0ID0gZnVuY3Rpb24gKG4pIHtcclxuICAgIERhdGEuaW5pdChuIHx8IDEwMCkudGhlbihmdW5jdGlvbiAoKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwiSW5pdGlhbGl6ZWQuXCIpO1xyXG4gICAgICBEYXRhLmNsb3NlKCkudGhlbihmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coXCJEYXRhYmFzZSBjbG9zZWQuXCIpO1xyXG4gICAgICB9KS5jYXRjaChmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkRhdGFiYXNlIGNvdWxkIG5vdCBiZSBjbG9zZWQuXCIpO1xyXG4gICAgICB9KTtcclxuICAgICAgd2luZG93LmRleGllVXBncmFkZSA9IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICBEYXRhLnVwZ3JhZGVEZXhpZSgpLnRoZW4oZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coXCJGaW5pc2hlZCB1cGdyYWRlLlwiKTtcclxuICAgICAgICB9KS5jYXRjaChmdW5jdGlvbiAoZXJyKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRGV4aWUgdXBncmFkZSBmYWlsZWQ6ICVvLlwiLCBlcnIpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9O1xyXG4gICAgICBjb25zb2xlLmxvZyhcIlJlYWR5IHRvIGRvIHVwZ3JhZGUuIFJ1biB3aXRoIGBkZXhpZVVwZ3JhZGVgXCIpO1xyXG4gICAgfSkuY2F0Y2goZnVuY3Rpb24gKGVycikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKFwiSW5pdGlhbGl6YXRpb24gZmFpbGVkOiAlby5cIiwgZXJyKTtcclxuICAgIH0pO1xyXG4gIH07XHJcbiAgY29uc29sZS5sb2coXCJSZWFkeSB0byBkbyBpbml0aWFsaXphdGlvbi4gUnVuIHdpdGggYGRleGllSW5pdChuKWBcIik7XHJcbn0pO1xyXG4iLCJ2YXIgRGV4aWUgPSByZXF1aXJlKCdkZXhpZScpO1xyXG5cclxudmFyIGRiO1xyXG4vLyBJbml0aWFsaXplIGRhdGFiYXNlIHdpdGggSW5kZXhlZERCIGFuZCBwb3B1bGF0ZSB3aXRoIG4gZW50cmllcy5cclxuZXhwb3J0cy5pbml0ID0gZnVuY3Rpb24obikge1xyXG4gIGNvbnNvbGUubG9nKFwiRGF0YSNpbml0XCIpO1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICB2YXIgcmVxID0gd2luZG93LmluZGV4ZWREQi5vcGVuKFwiZGF0YWJhc2VcIiwgMSk7XHJcbiAgICByZXEub251cGdyYWRlbmVlZGVkID0gZnVuY3Rpb24gKGUpIHtcclxuICAgICAgY29uc29sZS5sb2coXCJJbml0aWFsaXppbmcgZGF0YWJhc2UuXCIpO1xyXG4gICAgICB2YXIgZGIgPSBlLnRhcmdldC5yZXN1bHQ7XHJcbiAgICAgIGRiLmNyZWF0ZU9iamVjdFN0b3JlKFwic3RvcmUxXCIsIHtcclxuICAgICAgICBhdXRvSW5jcmVtZW50OiB0cnVlXHJcbiAgICAgIH0pO1xyXG4gICAgfTtcclxuXHJcbiAgICByZXEub25lcnJvciA9IGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvciBvcGVuaW5nIGRhdGFiYXNlLlwiKTtcclxuICAgIH07XHJcblxyXG4gICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwiRGF0YWJhc2Ugb3BlbmVkLlwiKTtcclxuICAgICAgZGIgPSBlLnRhcmdldC5yZXN1bHQ7XHJcbiAgICAgIHBvcHVsYXRlKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEdldCBzYW1wbGUgZGF0YSBhbmQgYWRkIG11bHRpcGxlIGVudHJpZXMuXHJcbiAgICBmdW5jdGlvbiBwb3B1bGF0ZSgpIHtcclxuICAgICAgdmFyIHVybCA9IGNocm9tZS5leHRlbnNpb24uZ2V0VVJMKFwicmVzb3VyY2VzL3JlcGxheS5qc29uXCIpO1xyXG4gICAgICB2YXIgcmVxID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XHJcbiAgICAgIHJlcS5hZGRFdmVudExpc3RlbmVyKFwibG9hZFwiLCBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgdmFyIHMgPSByZXEucmVzcG9uc2VUZXh0O1xyXG4gICAgICAgIHZhciBzdG9yZSA9IGRiLnRyYW5zYWN0aW9uKFtcInN0b3JlMVwiXSwgXCJyZWFkd3JpdGVcIikub2JqZWN0U3RvcmUoXCJzdG9yZTFcIik7XHJcbiAgICAgICAgdmFyIGkgPSAwO1xyXG4gICAgICAgIHZhciBkYnJlcSA9IHN0b3JlLmFkZChzLCBpKTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gZXJyb3IoZSkge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGFkZGluZzogJW8uXCIsIGUpO1xyXG4gICAgICAgICAgcmVqZWN0KGUpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZGJyZXEub25zdWNjZXNzID0gZnVuY3Rpb24gbG9vcCgpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKFwiQWRkZWQgJWQuXCIsIGkpO1xyXG4gICAgICAgICAgaSsrO1xyXG4gICAgICAgICAgaWYgKGkgPCBuKSB7XHJcbiAgICAgICAgICAgIHZhciByZXEgPSBzdG9yZS5hZGQocywgaSk7XHJcbiAgICAgICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBsb29wO1xyXG4gICAgICAgICAgICByZXEub25lcnJvciA9IGVycm9yO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcmVzb2x2ZShkYik7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgICAgICBkYnJlcS5vbmVycm9yID0gZXJyb3I7XHJcbiAgICAgIH0pO1xyXG4gICAgICByZXEub3BlbihcIkdFVFwiLCB1cmwpO1xyXG4gICAgICByZXEuc2VuZCgpO1xyXG4gICAgfVxyXG4gIH0pO1xyXG59O1xyXG5cclxuZXhwb3J0cy5jbG9zZSA9IGZ1bmN0aW9uICgpIHtcclxuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgZGIub25jbG9zZSA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICByZXNvbHZlKCk7XHJcbiAgICB9O1xyXG4gICAgZGIuY2xvc2UoKTtcclxuICB9KTtcclxufTtcclxuXHJcbi8vIEluaXRpYWxpemUgbmV3IGRiIGluc3RhbmNlIHVzaW5nIGRleGllIGFuZCBhdHRlbXB0IHVwZ3JhZGUuXHJcbmV4cG9ydHMudXBncmFkZURleGllID0gZnVuY3Rpb24gKCkge1xyXG4gIHZhciBkYiA9IG5ldyBEZXhpZShcImRhdGFiYXNlXCIpO1xyXG5cclxuICAvLyBJbml0aWFsIHZlcnNpb25zIG9mIHRoZSBkYXRhYmFzZSBtYXkgYmUgZWl0aGVyIDEgb3IgMiB3aXRoXHJcbiAgLy8gYSAncG9zaXRpb25zJyBvYmplY3Qgc3RvcmUgYW5kIGFuIGVtcHR5ICdzYXZlZE1vdmllcycgb2JqZWN0XHJcbiAgLy8gc3RvcmUuXHJcbiAgZGIudmVyc2lvbigwLjEpLnN0b3Jlcyh7XHJcbiAgICBzdG9yZTE6ICcnXHJcbiAgfSk7XHJcblxyXG4gIC8vIEN1cnJlbnQgdmVyc2lvbi5cclxuICBkYi52ZXJzaW9uKDIpLnN0b3Jlcyh7XHJcbiAgICBzdG9yZTI6ICcrK2lkJyxcclxuICAgIHN0b3JlMTogbnVsbFxyXG4gIH0pLnVwZ3JhZGUoZnVuY3Rpb24gKHRyYW5zKSB7XHJcbiAgICBjb25zb2xlLmxvZyhcIkV4ZWN1dGluZyBEZXhpZSB1cGdyYWRlLlwiKTtcclxuICAgIHRyYW5zLm9uKCdjb21wbGV0ZScsIGZ1bmN0aW9uICgpIHtcclxuICAgICAgY29uc29sZS5sb2coXCJUcmFuc2FjdGlvbiBjb21wbGV0ZWQuXCIpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdHJhbnMub24oJ2Fib3J0JywgZnVuY3Rpb24gKCkge1xyXG4gICAgICBjb25zb2xlLndhcm4oXCJpbnNpZGUgdHJhbnNhY3Rpb24gYWJvcnQgaGFuZGxlclwiKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHRyYW5zLm9uKCdlcnJvcicsIGZ1bmN0aW9uICgpIHtcclxuICAgICAgY29uc29sZS53YXJuKFwiSW5zaWRlIHRyYW5zYWN0aW9uIGVycm9yIGhhbmRsZXIuXCIpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdHJhbnMuc3RvcmUxLmNvdW50KCkudGhlbihmdW5jdGlvbiAodG90YWwpIHtcclxuICAgICAgdmFyIGRvbmUgPSAwO1xyXG4gICAgICB0cmFucy5zdG9yZTEuZWFjaChmdW5jdGlvbiAoaXRlbSwgY3Vyc29yKSB7XHJcbiAgICAgICAgdmFyIGRhdGEgPSB7XHJcbiAgICAgICAgICBkYXRhOiBKU09OLnBhcnNlKGl0ZW0pXHJcbiAgICAgICAgfTtcclxuICAgICAgICB0cmFucy5zdG9yZTIuYWRkKGRhdGEpLnRoZW4oZnVuY3Rpb24gKGlkKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhcIkZpbmlzaGVkIGRhdGE6ICVkLlwiLCArK2RvbmUpO1xyXG4gICAgICAgIH0pLmNhdGNoKGZ1bmN0aW9uIChlcnIpIHtcclxuICAgICAgICAgIC8vIENhdGNoIHJlcGxheSBjb252ZXJzaW9uIG9yIHNhdmUgZXJyb3IuXHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFwiQ291bGRuJ3Qgc2F2ZSBkdWUgdG86ICVvLlwiLCBlKTtcclxuICAgICAgICAgIHRyYW5zLmFib3J0KCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIHJldHVybiBkYi5vcGVuKCk7XHJcbn07XHJcblxyXG5leHBvcnRzLnVwZ3JhZGVOYXRpdmUgPSBmdW5jdGlvbiAoKSB7XHJcblxyXG59O1xyXG5cclxuZXhwb3J0cy5kZWxldGUgPSBmdW5jdGlvbiAoKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgIHZhciByZXEgPSBpbmRleGVkREIuZGVsZXRlRGF0YWJhc2UoXCJkYXRhYmFzZVwiKTtcclxuICAgIHJlcS5vbmVycm9yID0gZnVuY3Rpb24oZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgZGVsZXRpbmcgZGF0YWJhc2UuXCIpO1xyXG4gICAgICByZWplY3QoKTtcclxuICAgIH07XHJcbiAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24oZSkge1xyXG4gICAgICBjb25zb2xlLmxvZyhcIkRhdGFiYXNlIGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5LlwiKTtcclxuICAgICAgcmVzb2x2ZSgpO1xyXG4gICAgfTtcclxuICB9KTtcclxufTtcclxuXHJcblxyXG4vLyBSZXNldCB0aGUgZGF0YWJhc2UsIGZvciBkZWJ1Z2dpbmcuXHJcbmV4cG9ydHMucmVzZXREYXRhYmFzZSA9IGZ1bmN0aW9uKCkge1xyXG4gIGRiLmRlbGV0ZSgpO1xyXG59O1xyXG4iLCIvKiBNaW5pbWFsaXN0aWMgSW5kZXhlZERCIFdyYXBwZXIgd2l0aCBCdWxsZXQgUHJvb2YgVHJhbnNhY3Rpb25zXHJcbiAgID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbiAgIEJ5IERhdmlkIEZhaGxhbmRlciwgZGF2aWQuZmFobGFuZGVyQGdtYWlsLmNvbVxyXG5cclxuICAgVmVyc2lvbiAxLjIgKGFscGhhIC0gbm90IHlldCBkaXN0cmlidXRlZCkgLSBEQVRFLCBZRUFSLlxyXG5cclxuICAgVGVzdGVkIHN1Y2Nlc3NmdWxseSBvbiBDaHJvbWUsIElFLCBGaXJlZm94IGFuZCBPcGVyYS5cclxuXHJcbiAgIE9mZmljaWFsIFdlYnNpdGU6IGh0dHBzOi8vZ2l0aHViLmNvbS9kZmFobGFuZGVyL0RleGllLmpzL3dpa2kvRGV4aWUuanNcclxuXHJcbiAgIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSBWZXJzaW9uIDIuMCwgSmFudWFyeSAyMDA0LCBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvXHJcbiovXHJcbihmdW5jdGlvbiAoZ2xvYmFsLCBwdWJsaXNoLCB1bmRlZmluZWQpIHtcclxuXHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbiAgICBmdW5jdGlvbiBleHRlbmQob2JqLCBleHRlbnNpb24pIHtcclxuICAgICAgICBpZiAodHlwZW9mIGV4dGVuc2lvbiAhPT0gJ29iamVjdCcpIGV4dGVuc2lvbiA9IGV4dGVuc2lvbigpOyAvLyBBbGxvdyB0byBzdXBwbHkgYSBmdW5jdGlvbiByZXR1cm5pbmcgdGhlIGV4dGVuc2lvbi4gVXNlZnVsIGZvciBzaW1wbGlmeWluZyBwcml2YXRlIHNjb3Blcy5cclxuICAgICAgICBPYmplY3Qua2V5cyhleHRlbnNpb24pLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xyXG4gICAgICAgICAgICBvYmpba2V5XSA9IGV4dGVuc2lvbltrZXldO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHJldHVybiBvYmo7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gZmlsdGVyUHJvcGVydGllcyhvYmosIGZuKSB7XHJcbiAgICAgICAgdmFyIG5ld09iaiA9IHt9O1xyXG4gICAgICAgIE9iamVjdC5rZXlzKG9iaikuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XHJcbiAgICAgICAgICAgIGlmIChmbihvYmpba2V5XSkpXHJcbiAgICAgICAgICAgICAgICBuZXdPYmpba2V5XSA9IG9ialtrZXldO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHJldHVybiBuZXdPYmo7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gZGVyaXZlKENoaWxkKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgZnJvbTogZnVuY3Rpb24gKFBhcmVudCkge1xyXG4gICAgICAgICAgICAgICAgQ2hpbGQucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShQYXJlbnQucHJvdG90eXBlKTtcclxuICAgICAgICAgICAgICAgIENoaWxkLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IENoaWxkO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICBleHRlbmQ6IGZ1bmN0aW9uIChleHRlbnNpb24pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXh0ZW5kKENoaWxkLnByb3RvdHlwZSwgdHlwZW9mIGV4dGVuc2lvbiAhPT0gJ29iamVjdCcgPyBleHRlbnNpb24oUGFyZW50LnByb3RvdHlwZSkgOiBleHRlbnNpb24pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIG92ZXJyaWRlKG9yaWdGdW5jLCBvdmVycmlkZWRGYWN0b3J5KSB7XHJcbiAgICAgICAgcmV0dXJuIG92ZXJyaWRlZEZhY3Rvcnkob3JpZ0Z1bmMpO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIERleGllKGRiTmFtZSwgb3B0aW9ucykge1xyXG4gICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cIm9wdGlvbnNcIiB0eXBlPVwiT2JqZWN0XCIgb3B0aW9uYWw9XCJ0cnVlXCI+U3BlY2lmeSBvbmx5IGlmIHlvdSB3aWNoIHRvIGNvbnRyb2wgd2hpY2ggYWRkb25zIHRoYXQgc2hvdWxkIHJ1biBvbiB0aGlzIGluc3RhbmNlPC9wYXJhbT5cclxuICAgICAgICB2YXIgYWRkb25zID0gKG9wdGlvbnMgJiYgb3B0aW9ucy5hZGRvbnMpIHx8IERleGllLmFkZG9ucztcclxuICAgICAgICAvLyBSZXNvbHZlIGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXM6XHJcbiAgICAgICAgdmFyIGRlcHMgPSBEZXhpZS5kZXBlbmRlbmNpZXM7XHJcbiAgICAgICAgdmFyIGluZGV4ZWREQiA9IGRlcHMuaW5kZXhlZERCLFxyXG4gICAgICAgICAgICBJREJLZXlSYW5nZSA9IGRlcHMuSURCS2V5UmFuZ2UsXHJcbiAgICAgICAgICAgIElEQlRyYW5zYWN0aW9uID0gZGVwcy5JREJUcmFuc2FjdGlvbjtcclxuXHJcbiAgICAgICAgdmFyIERPTUVycm9yID0gZGVwcy5ET01FcnJvcixcclxuICAgICAgICAgICAgVHlwZUVycm9yID0gZGVwcy5UeXBlRXJyb3IsXHJcbiAgICAgICAgICAgIEVycm9yID0gZGVwcy5FcnJvcjtcclxuXHJcbiAgICAgICAgdmFyIGdsb2JhbFNjaGVtYSA9IHRoaXMuX2RiU2NoZW1hID0ge307XHJcbiAgICAgICAgdmFyIHZlcnNpb25zID0gW107XHJcbiAgICAgICAgdmFyIGRiU3RvcmVOYW1lcyA9IFtdO1xyXG4gICAgICAgIHZhciBhbGxUYWJsZXMgPSB7fTtcclxuICAgICAgICB2YXIgbm90SW5UcmFuc0ZhbGxiYWNrVGFibGVzID0ge307XHJcbiAgICAgICAgLy8vPHZhciB0eXBlPVwiSURCRGF0YWJhc2VcIiAvPlxyXG4gICAgICAgIHZhciBpZGJkYiA9IG51bGw7IC8vIEluc3RhbmNlIG9mIElEQkRhdGFiYXNlXHJcbiAgICAgICAgdmFyIGRiX2lzX2Jsb2NrZWQgPSB0cnVlO1xyXG4gICAgICAgIHZhciBkYk9wZW5FcnJvciA9IG51bGw7XHJcbiAgICAgICAgdmFyIGlzQmVpbmdPcGVuZWQgPSBmYWxzZTtcclxuICAgICAgICB2YXIgUkVBRE9OTFkgPSBcInJlYWRvbmx5XCIsIFJFQURXUklURSA9IFwicmVhZHdyaXRlXCI7XHJcbiAgICAgICAgdmFyIGRiID0gdGhpcztcclxuICAgICAgICB2YXIgcGF1c2VkUmVzdW1lYWJsZXMgPSBbXTtcclxuICAgICAgICB2YXIgYXV0b1NjaGVtYSA9IGZhbHNlO1xyXG4gICAgICAgIHZhciBoYXNOYXRpdmVHZXREYXRhYmFzZU5hbWVzID0gISFnZXROYXRpdmVHZXREYXRhYmFzZU5hbWVzRm4oKTtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gaW5pdCgpIHtcclxuICAgICAgICAgICAgLy8gSWYgYnJvd3NlciAobm90IG5vZGUuanMgb3Igb3RoZXIpLCBzdWJzY3JpYmUgdG8gdmVyc2lvbmNoYW5nZSBldmVudCBhbmQgcmVsb2FkIHBhZ2VcclxuICAgICAgICAgICAgZGIub24oXCJ2ZXJzaW9uY2hhbmdlXCIsIGZ1bmN0aW9uIChldikge1xyXG4gICAgICAgICAgICAgICAgLy8gRGVmYXVsdCBiZWhhdmlvciBmb3IgdmVyc2lvbmNoYW5nZSBldmVudCBpcyB0byBjbG9zZSBkYXRhYmFzZSBjb25uZWN0aW9uLlxyXG4gICAgICAgICAgICAgICAgLy8gQ2FsbGVyIGNhbiBvdmVycmlkZSB0aGlzIGJlaGF2aW9yIGJ5IGRvaW5nIGRiLm9uKFwidmVyc2lvbmNoYW5nZVwiLCBmdW5jdGlvbigpeyByZXR1cm4gZmFsc2U7IH0pO1xyXG4gICAgICAgICAgICAgICAgLy8gTGV0J3Mgbm90IGJsb2NrIHRoZSBvdGhlciB3aW5kb3cgZnJvbSBtYWtpbmcgaXQncyBkZWxldGUoKSBvciBvcGVuKCkgY2FsbC5cclxuICAgICAgICAgICAgICAgIGRiLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICBkYi5vbignZXJyb3InKS5maXJlKG5ldyBFcnJvcihcIkRhdGFiYXNlIHZlcnNpb24gY2hhbmdlZCBieSBvdGhlciBkYXRhYmFzZSBjb25uZWN0aW9uLlwiKSk7XHJcbiAgICAgICAgICAgICAgICAvLyBJbiBtYW55IHdlYiBhcHBsaWNhdGlvbnMsIGl0IHdvdWxkIGJlIHJlY29tbWVuZGVkIHRvIGZvcmNlIHdpbmRvdy5yZWxvYWQoKVxyXG4gICAgICAgICAgICAgICAgLy8gd2hlbiB0aGlzIGV2ZW50IG9jY3Vycy4gRG8gZG8gdGhhdCwgc3Vic2NyaWJlIHRvIHRoZSB2ZXJzaW9uY2hhbmdlIGV2ZW50XHJcbiAgICAgICAgICAgICAgICAvLyBhbmQgY2FsbCB3aW5kb3cubG9jYXRpb24ucmVsb2FkKHRydWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gVmVyc2lvbmluZyBGcmFtZXdvcmstLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuXHJcbiAgICAgICAgdGhpcy52ZXJzaW9uID0gZnVuY3Rpb24gKHZlcnNpb25OdW1iZXIpIHtcclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwidmVyc2lvbk51bWJlclwiIHR5cGU9XCJOdW1iZXJcIj48L3BhcmFtPlxyXG4gICAgICAgICAgICAvLy8gPHJldHVybnMgdHlwZT1cIlZlcnNpb25cIj48L3JldHVybnM+XHJcbiAgICAgICAgICAgIGlmIChpZGJkYikgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGFkZCB2ZXJzaW9uIHdoZW4gZGF0YWJhc2UgaXMgb3BlblwiKTtcclxuICAgICAgICAgICAgdGhpcy52ZXJubyA9IE1hdGgubWF4KHRoaXMudmVybm8sIHZlcnNpb25OdW1iZXIpO1xyXG4gICAgICAgICAgICB2YXIgdmVyc2lvbkluc3RhbmNlID0gdmVyc2lvbnMuZmlsdGVyKGZ1bmN0aW9uICh2KSB7IHJldHVybiB2Ll9jZmcudmVyc2lvbiA9PT0gdmVyc2lvbk51bWJlcjsgfSlbMF07XHJcbiAgICAgICAgICAgIGlmICh2ZXJzaW9uSW5zdGFuY2UpIHJldHVybiB2ZXJzaW9uSW5zdGFuY2U7XHJcbiAgICAgICAgICAgIHZlcnNpb25JbnN0YW5jZSA9IG5ldyBWZXJzaW9uKHZlcnNpb25OdW1iZXIpO1xyXG4gICAgICAgICAgICB2ZXJzaW9ucy5wdXNoKHZlcnNpb25JbnN0YW5jZSk7XHJcbiAgICAgICAgICAgIHZlcnNpb25zLnNvcnQobG93ZXJWZXJzaW9uRmlyc3QpO1xyXG4gICAgICAgICAgICByZXR1cm4gdmVyc2lvbkluc3RhbmNlO1xyXG4gICAgICAgIH07IFxyXG5cclxuICAgICAgICBmdW5jdGlvbiBWZXJzaW9uKHZlcnNpb25OdW1iZXIpIHtcclxuICAgICAgICAgICAgdGhpcy5fY2ZnID0ge1xyXG4gICAgICAgICAgICAgICAgdmVyc2lvbjogdmVyc2lvbk51bWJlcixcclxuICAgICAgICAgICAgICAgIHN0b3Jlc1NvdXJjZTogbnVsbCxcclxuICAgICAgICAgICAgICAgIGRic2NoZW1hOiB7fSxcclxuICAgICAgICAgICAgICAgIHRhYmxlczoge30sXHJcbiAgICAgICAgICAgICAgICBjb250ZW50VXBncmFkZTogbnVsbFxyXG4gICAgICAgICAgICB9OyBcclxuICAgICAgICAgICAgdGhpcy5zdG9yZXMoe30pOyAvLyBEZXJpdmUgZWFybGllciBzY2hlbWFzIGJ5IGRlZmF1bHQuXHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBleHRlbmQoVmVyc2lvbi5wcm90b3R5cGUsIHtcclxuICAgICAgICAgICAgc3RvcmVzOiBmdW5jdGlvbiAoc3RvcmVzKSB7XHJcbiAgICAgICAgICAgICAgICAvLy8gPHN1bW1hcnk+XHJcbiAgICAgICAgICAgICAgICAvLy8gICBEZWZpbmVzIHRoZSBzY2hlbWEgZm9yIGEgcGFydGljdWxhciB2ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICAvLy8gPC9zdW1tYXJ5PlxyXG4gICAgICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwic3RvcmVzXCIgdHlwZT1cIk9iamVjdFwiPlxyXG4gICAgICAgICAgICAgICAgLy8vIEV4YW1wbGU6IDxici8+XHJcbiAgICAgICAgICAgICAgICAvLy8gICB7dXNlcnM6IFwiaWQrKyxmaXJzdCxsYXN0LCZhbXA7dXNlcm5hbWUsKmVtYWlsXCIsIDxici8+XHJcbiAgICAgICAgICAgICAgICAvLy8gICBwYXNzd29yZHM6IFwiaWQrKywmYW1wO3VzZXJuYW1lXCJ9PGJyLz5cclxuICAgICAgICAgICAgICAgIC8vLyA8YnIvPlxyXG4gICAgICAgICAgICAgICAgLy8vIFN5bnRheDoge1RhYmxlOiBcIltwcmltYXJ5S2V5XVsrK10sWyZhbXA7XVsqXWluZGV4MSxbJmFtcDtdWypdaW5kZXgyLC4uLlwifTxici8+PGJyLz5cclxuICAgICAgICAgICAgICAgIC8vLyBTcGVjaWFsIGNoYXJhY3RlcnM6PGJyLz5cclxuICAgICAgICAgICAgICAgIC8vLyAgXCImYW1wO1wiICBtZWFucyB1bmlxdWUga2V5LCA8YnIvPlxyXG4gICAgICAgICAgICAgICAgLy8vICBcIipcIiAgbWVhbnMgdmFsdWUgaXMgbXVsdGlFbnRyeSwgPGJyLz5cclxuICAgICAgICAgICAgICAgIC8vLyAgXCIrK1wiIG1lYW5zIGF1dG8taW5jcmVtZW50IGFuZCBvbmx5IGFwcGxpY2FibGUgZm9yIHByaW1hcnkga2V5IDxici8+XHJcbiAgICAgICAgICAgICAgICAvLy8gPC9wYXJhbT5cclxuICAgICAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgICAgICAgICAgICAgIHRoaXMuX2NmZy5zdG9yZXNTb3VyY2UgPSB0aGlzLl9jZmcuc3RvcmVzU291cmNlID8gZXh0ZW5kKHRoaXMuX2NmZy5zdG9yZXNTb3VyY2UsIHN0b3JlcykgOiBzdG9yZXM7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gRGVyaXZlIHN0b3JlcyBmcm9tIGVhcmxpZXIgdmVyc2lvbnMgaWYgdGhleSBhcmUgbm90IGV4cGxpY2l0ZWx5IHNwZWNpZmllZCBhcyBudWxsIG9yIGEgbmV3IHN5bnRheC5cclxuICAgICAgICAgICAgICAgIHZhciBzdG9yZXNTcGVjID0ge307XHJcbiAgICAgICAgICAgICAgICAvLyBEaXNyZWdhcmQgZGVsZXRlZCBzdG9yZXMgZm9yIHVwZ3JhZGUgc2NoZW1hLlxyXG4gICAgICAgICAgICAgICAgdmFyIHVwZ3JhZGVTdG9yZXNTcGVjID0ge307XHJcbiAgICAgICAgICAgICAgICB2ZXJzaW9ucy5mb3JFYWNoKGZ1bmN0aW9uICh2ZXJzaW9uKSB7IC8vICd2ZXJzaW9ucycgaXMgYWx3YXlzIHNvcnRlZCBieSBsb3dlc3QgdmVyc2lvbiBmaXJzdC5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodmVyc2lvbiA9PT0gc2VsZikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgbm9uRGVsZXRlU3RvcmVzU291cmNlID0gZmlsdGVyUHJvcGVydGllcyh2ZXJzaW9uLl9jZmcuc3RvcmVzU291cmNlLCBmdW5jdGlvbiAodikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHYgIT09IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBleHRlbmQodXBncmFkZVN0b3Jlc1NwZWMsIHN0b3Jlc1NwZWMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBleHRlbmQodXBncmFkZVN0b3Jlc1NwZWMsIG5vbkRlbGV0ZVN0b3Jlc1NvdXJjZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGV4dGVuZChzdG9yZXNTcGVjLCB2ZXJzaW9uLl9jZmcuc3RvcmVzU291cmNlKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG5cclxuXHJcbiAgICAgICAgICAgICAgICB2YXIgZGJzY2hlbWEgPSAodGhpcy5fY2ZnLmRic2NoZW1hID0ge30pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fcGFyc2VTdG9yZXNTcGVjKHN0b3Jlc1NwZWMsIGRic2NoZW1hKTtcclxuICAgICAgICAgICAgICAgIHZhciBwcmVVcGdyYWRlRGJTY2hlbWEgPSAodGhpcy5fY2ZnLnByZVVwZ3JhZGVEYlNjaGVtYSA9IHt9KTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3BhcnNlU3RvcmVzU3BlYyh1cGdyYWRlU3RvcmVzU3BlYywgcHJlVXBncmFkZURiU2NoZW1hKTtcclxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgbGF0ZXN0IHNjaGVtYSB0byB0aGlzIHZlcnNpb25cclxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBBUElcclxuICAgICAgICAgICAgICAgIGdsb2JhbFNjaGVtYSA9IGRiLl9kYlNjaGVtYSA9IGRic2NoZW1hO1xyXG4gICAgICAgICAgICAgICAgcmVtb3ZlVGFibGVzQXBpKFthbGxUYWJsZXMsIGRiLCBub3RJblRyYW5zRmFsbGJhY2tUYWJsZXNdKTtcclxuICAgICAgICAgICAgICAgIHNldEFwaU9uUGxhY2UoW25vdEluVHJhbnNGYWxsYmFja1RhYmxlc10sIHRhYmxlTm90SW5UcmFuc2FjdGlvbiwgT2JqZWN0LmtleXMoZGJzY2hlbWEpLCBSRUFEV1JJVEUsIGRic2NoZW1hKTtcclxuICAgICAgICAgICAgICAgIHNldEFwaU9uUGxhY2UoW2FsbFRhYmxlcywgZGIsIHRoaXMuX2NmZy50YWJsZXNdLCBkYi5fdHJhbnNQcm9taXNlRmFjdG9yeSwgT2JqZWN0LmtleXMoZGJzY2hlbWEpLCBSRUFEV1JJVEUsIGRic2NoZW1hLCB0cnVlKTtcclxuICAgICAgICAgICAgICAgIGRiU3RvcmVOYW1lcyA9IE9iamVjdC5rZXlzKGRic2NoZW1hKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB1cGdyYWRlOiBmdW5jdGlvbiAodXBncmFkZUZ1bmN0aW9uKSB7XHJcbiAgICAgICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJ1cGdyYWRlRnVuY3Rpb25cIiBvcHRpb25hbD1cInRydWVcIj5GdW5jdGlvbiB0aGF0IHBlcmZvcm1zIHVwZ3JhZGluZyBhY3Rpb25zLjwvcGFyYW0+XHJcbiAgICAgICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICAgICAgICAgICAgICBmYWtlQXV0b0NvbXBsZXRlKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICB1cGdyYWRlRnVuY3Rpb24oZGIuX2NyZWF0ZVRyYW5zYWN0aW9uKFJFQURXUklURSwgT2JqZWN0LmtleXMoc2VsZi5fY2ZnLmRic2NoZW1hKSwgc2VsZi5fY2ZnLmRic2NoZW1hKSk7Ly8gQlVHQlVHOiBObyBjb2RlIGNvbXBsZXRpb24gZm9yIHByZXYgdmVyc2lvbidzIHRhYmxlcyB3b250IGFwcGVhci5cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fY2ZnLmNvbnRlbnRVcGdyYWRlID0gdXBncmFkZUZ1bmN0aW9uO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF9wYXJzZVN0b3Jlc1NwZWM6IGZ1bmN0aW9uIChzdG9yZXMsIG91dFNjaGVtYSkge1xyXG4gICAgICAgICAgICAgICAgT2JqZWN0LmtleXMoc3RvcmVzKS5mb3JFYWNoKGZ1bmN0aW9uICh0YWJsZU5hbWUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc3RvcmVzW3RhYmxlTmFtZV0gIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGluc3RhbmNlVGVtcGxhdGUgPSB7fTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGluZGV4ZXMgPSBwYXJzZUluZGV4U3ludGF4KHN0b3Jlc1t0YWJsZU5hbWVdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHByaW1LZXkgPSBpbmRleGVzLnNoaWZ0KCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwcmltS2V5Lm11bHRpKSB0aHJvdyBuZXcgRXJyb3IoXCJQcmltYXJ5IGtleSBjYW5ub3QgYmUgbXVsdGktdmFsdWVkXCIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocHJpbUtleS5rZXlQYXRoKSBzZXRCeUtleVBhdGgoaW5zdGFuY2VUZW1wbGF0ZSwgcHJpbUtleS5rZXlQYXRoLCBwcmltS2V5LmF1dG8gPyAwIDogcHJpbUtleS5rZXlQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXhlcy5mb3JFYWNoKGZ1bmN0aW9uIChpZHgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpZHguYXV0bykgdGhyb3cgbmV3IEVycm9yKFwiT25seSBwcmltYXJ5IGtleSBjYW4gYmUgbWFya2VkIGFzIGF1dG9JbmNyZW1lbnQgKCsrKVwiKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghaWR4LmtleVBhdGgpIHRocm93IG5ldyBFcnJvcihcIkluZGV4IG11c3QgaGF2ZSBhIG5hbWUgYW5kIGNhbm5vdCBiZSBhbiBlbXB0eSBzdHJpbmdcIik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXRCeUtleVBhdGgoaW5zdGFuY2VUZW1wbGF0ZSwgaWR4LmtleVBhdGgsIGlkeC5jb21wb3VuZCA/IGlkeC5rZXlQYXRoLm1hcChmdW5jdGlvbiAoKSB7IHJldHVybiBcIlwiOyB9KSA6IFwiXCIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgb3V0U2NoZW1hW3RhYmxlTmFtZV0gPSBuZXcgVGFibGVTY2hlbWEodGFibGVOYW1lLCBwcmltS2V5LCBpbmRleGVzLCBpbnN0YW5jZVRlbXBsYXRlKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBmdW5jdGlvbiBydW5VcGdyYWRlcnMob2xkVmVyc2lvbiwgaWRidHJhbnMsIHJlamVjdCwgb3BlblJlcSkge1xyXG4gICAgICAgICAgICBpZiAob2xkVmVyc2lvbiA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgLy9nbG9iYWxTY2hlbWEgPSB2ZXJzaW9uc1t2ZXJzaW9ucy5sZW5ndGggLSAxXS5fY2ZnLmRic2NoZW1hO1xyXG4gICAgICAgICAgICAgICAgLy8gQ3JlYXRlIHRhYmxlczpcclxuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKGdsb2JhbFNjaGVtYSkuZm9yRWFjaChmdW5jdGlvbiAodGFibGVOYW1lKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY3JlYXRlVGFibGUoaWRidHJhbnMsIHRhYmxlTmFtZSwgZ2xvYmFsU2NoZW1hW3RhYmxlTmFtZV0ucHJpbUtleSwgZ2xvYmFsU2NoZW1hW3RhYmxlTmFtZV0uaW5kZXhlcyk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIC8vIFBvcHVsYXRlIGRhdGFcclxuICAgICAgICAgICAgICAgIHZhciB0ID0gZGIuX2NyZWF0ZVRyYW5zYWN0aW9uKFJFQURXUklURSwgZGJTdG9yZU5hbWVzLCBnbG9iYWxTY2hlbWEpO1xyXG4gICAgICAgICAgICAgICAgdC5pZGJ0cmFucyA9IGlkYnRyYW5zO1xyXG4gICAgICAgICAgICAgICAgdC5pZGJ0cmFucy5vbmVycm9yID0gZXZlbnRSZWplY3RIYW5kbGVyKHJlamVjdCwgW1wicG9wdWxhdGluZyBkYXRhYmFzZVwiXSk7XHJcbiAgICAgICAgICAgICAgICB0Lm9uKCdlcnJvcicpLnN1YnNjcmliZShyZWplY3QpO1xyXG4gICAgICAgICAgICAgICAgUHJvbWlzZS5uZXdQU0QoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIFByb21pc2UuUFNELnRyYW5zID0gdDtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkYi5vbihcInBvcHVsYXRlXCIpLmZpcmUodCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5SZXEub25lcnJvciA9IGlkYnRyYW5zLm9uZXJyb3IgPSBmdW5jdGlvbiAoZXYpIHsgZXYucHJldmVudERlZmF1bHQoKTsgfTsgIC8vIFByb2hpYml0IEFib3J0RXJyb3IgZmlyZSBvbiBkYi5vbihcImVycm9yXCIpIGluIEZpcmVmb3guXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7IGlkYnRyYW5zLmFib3J0KCk7IH0gY2F0Y2ggKGUpIHsgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZGJ0cmFucy5kYi5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIC8vIFVwZ3JhZGUgdmVyc2lvbiB0byB2ZXJzaW9uLCBzdGVwLWJ5LXN0ZXAgZnJvbSBvbGRlc3QgdG8gbmV3ZXN0IHZlcnNpb24uXHJcbiAgICAgICAgICAgICAgICAvLyBFYWNoIHRyYW5zYWN0aW9uIG9iamVjdCB3aWxsIGNvbnRhaW4gdGhlIHRhYmxlIHNldCB0aGF0IHdhcyBjdXJyZW50IGluIHRoYXQgdmVyc2lvbiAoYnV0IGFsc28gbm90LXlldC1kZWxldGVkIHRhYmxlcyBmcm9tIGl0cyBwcmV2aW91cyB2ZXJzaW9uKVxyXG4gICAgICAgICAgICAgICAgdmFyIHF1ZXVlID0gW107XHJcbiAgICAgICAgICAgICAgICB2YXIgb2xkVmVyc2lvblN0cnVjdCA9IHZlcnNpb25zLmZpbHRlcihmdW5jdGlvbiAodmVyc2lvbikgeyByZXR1cm4gdmVyc2lvbi5fY2ZnLnZlcnNpb24gPT09IG9sZFZlcnNpb247IH0pWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFvbGRWZXJzaW9uU3RydWN0KSB0aHJvdyBuZXcgRXJyb3IoXCJEZXhpZSBzcGVjaWZpY2F0aW9uIG9mIGN1cnJlbnRseSBpbnN0YWxsZWQgREIgdmVyc2lvbiBpcyBtaXNzaW5nXCIpO1xyXG4gICAgICAgICAgICAgICAgZ2xvYmFsU2NoZW1hID0gZGIuX2RiU2NoZW1hID0gb2xkVmVyc2lvblN0cnVjdC5fY2ZnLmRic2NoZW1hO1xyXG4gICAgICAgICAgICAgICAgdmFyIGFueUNvbnRlbnRVcGdyYWRlckhhc1J1biA9IGZhbHNlO1xyXG5cclxuICAgICAgICAgICAgICAgIHZhciB2ZXJzVG9SdW4gPSB2ZXJzaW9ucy5maWx0ZXIoZnVuY3Rpb24gKHYpIHsgcmV0dXJuIHYuX2NmZy52ZXJzaW9uID4gb2xkVmVyc2lvbjsgfSk7XHJcbiAgICAgICAgICAgICAgICB2ZXJzVG9SdW4uZm9yRWFjaChmdW5jdGlvbiAodmVyc2lvbikge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cInZlcnNpb25cIiB0eXBlPVwiVmVyc2lvblwiPjwvcGFyYW0+XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIG9sZFNjaGVtYSA9IGdsb2JhbFNjaGVtYTtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgbmV3U2NoZW1hID0gdmVyc2lvbi5fY2ZnLmRic2NoZW1hO1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciB1cGRhdGVTY2hlbWEgPSB2ZXJzaW9uLl9jZmcucHJlVXBncmFkZURiU2NoZW1hO1xyXG4gICAgICAgICAgICAgICAgICAgIGFkanVzdFRvRXhpc3RpbmdJbmRleE5hbWVzKG9sZFNjaGVtYSwgaWRidHJhbnMpO1xyXG4gICAgICAgICAgICAgICAgICAgIGFkanVzdFRvRXhpc3RpbmdJbmRleE5hbWVzKG5ld1NjaGVtYSwgaWRidHJhbnMpO1xyXG4gICAgICAgICAgICAgICAgICAgIGFkanVzdFRvRXhpc3RpbmdJbmRleE5hbWVzKHVwZGF0ZVNjaGVtYSwgaWRidHJhbnMpO1xyXG4gICAgICAgICAgICAgICAgICAgIGdsb2JhbFNjaGVtYSA9IGRiLl9kYlNjaGVtYSA9IG5ld1NjaGVtYTtcclxuICAgICAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBkaWZmID0gZ2V0U2NoZW1hRGlmZihvbGRTY2hlbWEsIG5ld1NjaGVtYSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpZmYuYWRkLmZvckVhY2goZnVuY3Rpb24gKHR1cGxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWV1ZS5wdXNoKGZ1bmN0aW9uIChpZGJ0cmFucywgY2IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVUYWJsZShpZGJ0cmFucywgdHVwbGVbMF0sIHR1cGxlWzFdLnByaW1LZXksIHR1cGxlWzFdLmluZGV4ZXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNiKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpZmYuY2hhbmdlLmZvckVhY2goZnVuY3Rpb24gKGNoYW5nZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNoYW5nZS5yZWNyZWF0ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vdCB5ZXQgc3VwcG9ydCBmb3IgY2hhbmdpbmcgcHJpbWFyeSBrZXlcIik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXVlLnB1c2goZnVuY3Rpb24gKGlkYnRyYW5zLCBjYikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgc3RvcmUgPSBpZGJ0cmFucy5vYmplY3RTdG9yZShjaGFuZ2UubmFtZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZS5hZGQuZm9yRWFjaChmdW5jdGlvbiAoaWR4KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhZGRJbmRleChzdG9yZSwgaWR4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZS5jaGFuZ2UuZm9yRWFjaChmdW5jdGlvbiAoaWR4KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdG9yZS5kZWxldGVJbmRleChpZHgubmFtZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhZGRJbmRleChzdG9yZSwgaWR4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZS5kZWwuZm9yRWFjaChmdW5jdGlvbiAoaWR4TmFtZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RvcmUuZGVsZXRlSW5kZXgoaWR4TmFtZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYigpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHZlcnNpb24uX2NmZy5jb250ZW50VXBncmFkZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVldWUucHVzaChmdW5jdGlvbiAoaWRidHJhbnMsIGNiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYW55Q29udGVudFVwZ3JhZGVySGFzUnVuID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgdCA9IGRiLl9jcmVhdGVUcmFuc2FjdGlvbihSRUFEV1JJVEUsIFtdLnNsaWNlLmNhbGwoaWRidHJhbnMuZGIub2JqZWN0U3RvcmVOYW1lcywgMCksIHVwZGF0ZVNjaGVtYSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdC5pZGJ0cmFucyA9IGlkYnRyYW5zO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciB1bmNvbXBsZXRlZFJlcXVlc3RzID0gMDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0Ll9wcm9taXNlID0gb3ZlcnJpZGUodC5fcHJvbWlzZSwgZnVuY3Rpb24gKG9yaWdfcHJvbWlzZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKG1vZGUsIGZuLCB3cml0ZUxvY2spIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICsrdW5jb21wbGV0ZWRSZXF1ZXN0cztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uIHByb3h5KGZuKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKC0tdW5jb21wbGV0ZWRSZXF1ZXN0cyA9PT0gMCkgY2IoKTsgLy8gQSBjYWxsZWQgZGIgb3BlcmF0aW9uIGhhcyBjb21wbGV0ZWQgd2l0aG91dCBzdGFydGluZyBhIG5ldyBvcGVyYXRpb24uIFRoZSBmbG93IGlzIGZpbmlzaGVkLCBub3cgcnVuIG5leHQgdXBncmFkZXIuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9yaWdfcHJvbWlzZS5jYWxsKHRoaXMsIG1vZGUsIGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QsIHRyYW5zKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXJndW1lbnRzWzBdID0gcHJveHkocmVzb2x2ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXJndW1lbnRzWzFdID0gcHJveHkocmVqZWN0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwgd3JpdGVMb2NrKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZGJ0cmFucy5vbmVycm9yID0gZXZlbnRSZWplY3RIYW5kbGVyKHJlamVjdCwgW1wicnVubmluZyB1cGdyYWRlciBmdW5jdGlvbiBmb3IgdmVyc2lvblwiLCB2ZXJzaW9uLl9jZmcudmVyc2lvbl0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHQub24oJ2Vycm9yJykuc3Vic2NyaWJlKHJlamVjdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbi5fY2ZnLmNvbnRlbnRVcGdyYWRlKHQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1bmNvbXBsZXRlZFJlcXVlc3RzID09PSAwKSBjYigpOyAvLyBjb250ZW50VXBncmFkZSgpIGRpZG50IGNhbGwgYW55IGRiIG9wZXJhdGlvbnMgYXQgYWxsLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFhbnlDb250ZW50VXBncmFkZXJIYXNSdW4gfHwgIWhhc0lFRGVsZXRlT2JqZWN0U3RvcmVCdWcoKSkgeyAvLyBEb250IGRlbGV0ZSBvbGQgdGFibGVzIGlmIGllQnVnIGlzIHByZXNlbnQgYW5kIGEgY29udGVudCB1cGdyYWRlciBoYXMgcnVuLiBMZXQgdGFibGVzIGJlIGxlZnQgaW4gREIgc28gZmFyLiBUaGlzIG5lZWRzIHRvIGJlIHRha2VuIGNhcmUgb2YuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWV1ZS5wdXNoKGZ1bmN0aW9uIChpZGJ0cmFucywgY2IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBEZWxldGUgb2xkIHRhYmxlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZVJlbW92ZWRUYWJsZXMobmV3U2NoZW1hLCBpZGJ0cmFucyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2IoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gTm93LCBjcmVhdGUgYSBxdWV1ZSBleGVjdXRpb24gZW5naW5lXHJcbiAgICAgICAgICAgICAgICB2YXIgcnVuTmV4dFF1ZXVlZEZ1bmN0aW9uID0gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChxdWV1ZS5sZW5ndGgpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWV1ZS5zaGlmdCgpKGlkYnRyYW5zLCBydW5OZXh0UXVldWVkRnVuY3Rpb24pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVNaXNzaW5nVGFibGVzKGdsb2JhbFNjaGVtYSwgaWRidHJhbnMpOyAvLyBBdCBsYXN0LCBtYWtlIHN1cmUgdG8gY3JlYXRlIGFueSBtaXNzaW5nIHRhYmxlcy4gKE5lZWRlZCBieSBhZGRvbnMgdGhhdCBhZGQgc3RvcmVzIHRvIERCIHdpdGhvdXQgc3BlY2lmeWluZyB2ZXJzaW9uKVxyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGVuUmVxLm9uZXJyb3IgPSBpZGJ0cmFucy5vbmVycm9yID0gZnVuY3Rpb24gKGV2KSB7IGV2LnByZXZlbnREZWZhdWx0KCk7IH07ICAvLyBQcm9oaWJpdCBBYm9ydEVycm9yIGZpcmUgb24gZGIub24oXCJlcnJvclwiKSBpbiBGaXJlZm94LlxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkgeyBpZGJ0cmFucy5hYm9ydCgpOyB9IGNhdGNoKGUpIHt9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkYnRyYW5zLmRiLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICBydW5OZXh0UXVldWVkRnVuY3Rpb24oKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gZ2V0U2NoZW1hRGlmZihvbGRTY2hlbWEsIG5ld1NjaGVtYSkge1xyXG4gICAgICAgICAgICB2YXIgZGlmZiA9IHtcclxuICAgICAgICAgICAgICAgIGRlbDogW10sIC8vIEFycmF5IG9mIHRhYmxlIG5hbWVzXHJcbiAgICAgICAgICAgICAgICBhZGQ6IFtdLCAvLyBBcnJheSBvZiBbdGFibGVOYW1lLCBuZXdEZWZpbml0aW9uXVxyXG4gICAgICAgICAgICAgICAgY2hhbmdlOiBbXSAvLyBBcnJheSBvZiB7bmFtZTogdGFibGVOYW1lLCByZWNyZWF0ZTogbmV3RGVmaW5pdGlvbiwgZGVsOiBkZWxJbmRleE5hbWVzLCBhZGQ6IG5ld0luZGV4RGVmcywgY2hhbmdlOiBjaGFuZ2VkSW5kZXhEZWZzfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBmb3IgKHZhciB0YWJsZSBpbiBvbGRTY2hlbWEpIHtcclxuICAgICAgICAgICAgICAgIGlmICghbmV3U2NoZW1hW3RhYmxlXSkgZGlmZi5kZWwucHVzaCh0YWJsZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZm9yICh2YXIgdGFibGUgaW4gbmV3U2NoZW1hKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgb2xkRGVmID0gb2xkU2NoZW1hW3RhYmxlXSxcclxuICAgICAgICAgICAgICAgICAgICBuZXdEZWYgPSBuZXdTY2hlbWFbdGFibGVdO1xyXG4gICAgICAgICAgICAgICAgaWYgKCFvbGREZWYpIGRpZmYuYWRkLnB1c2goW3RhYmxlLCBuZXdEZWZdKTtcclxuICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBjaGFuZ2UgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IHRhYmxlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWY6IG5ld1NjaGVtYVt0YWJsZV0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlY3JlYXRlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVsOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWRkOiBbXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlOiBbXVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9sZERlZi5wcmltS2V5LnNyYyAhPT0gbmV3RGVmLnByaW1LZXkuc3JjKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFByaW1hcnkga2V5IGhhcyBjaGFuZ2VkLiBSZW1vdmUgYW5kIHJlLWFkZCB0YWJsZS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlLnJlY3JlYXRlID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGlmZi5jaGFuZ2UucHVzaChjaGFuZ2UpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBvbGRJbmRleGVzID0gb2xkRGVmLmluZGV4ZXMucmVkdWNlKGZ1bmN0aW9uIChwcmV2LCBjdXJyZW50KSB7IHByZXZbY3VycmVudC5uYW1lXSA9IGN1cnJlbnQ7IHJldHVybiBwcmV2OyB9LCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBuZXdJbmRleGVzID0gbmV3RGVmLmluZGV4ZXMucmVkdWNlKGZ1bmN0aW9uIChwcmV2LCBjdXJyZW50KSB7IHByZXZbY3VycmVudC5uYW1lXSA9IGN1cnJlbnQ7IHJldHVybiBwcmV2OyB9LCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGlkeE5hbWUgaW4gb2xkSW5kZXhlcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFuZXdJbmRleGVzW2lkeE5hbWVdKSBjaGFuZ2UuZGVsLnB1c2goaWR4TmFtZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaWR4TmFtZSBpbiBuZXdJbmRleGVzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgb2xkSWR4ID0gb2xkSW5kZXhlc1tpZHhOYW1lXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXdJZHggPSBuZXdJbmRleGVzW2lkeE5hbWVdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFvbGRJZHgpIGNoYW5nZS5hZGQucHVzaChuZXdJZHgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAob2xkSWR4LnNyYyAhPT0gbmV3SWR4LnNyYykgY2hhbmdlLmNoYW5nZS5wdXNoKG5ld0lkeCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNoYW5nZS5yZWNyZWF0ZSB8fCBjaGFuZ2UuZGVsLmxlbmd0aCA+IDAgfHwgY2hhbmdlLmFkZC5sZW5ndGggPiAwIHx8IGNoYW5nZS5jaGFuZ2UubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGlmZi5jaGFuZ2UucHVzaChjaGFuZ2UpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBkaWZmO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gY3JlYXRlVGFibGUoaWRidHJhbnMsIHRhYmxlTmFtZSwgcHJpbUtleSwgaW5kZXhlcykge1xyXG4gICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJpZGJ0cmFuc1wiIHR5cGU9XCJJREJUcmFuc2FjdGlvblwiPjwvcGFyYW0+XHJcbiAgICAgICAgICAgIHZhciBzdG9yZSA9IGlkYnRyYW5zLmRiLmNyZWF0ZU9iamVjdFN0b3JlKHRhYmxlTmFtZSwgcHJpbUtleS5rZXlQYXRoID8geyBrZXlQYXRoOiBwcmltS2V5LmtleVBhdGgsIGF1dG9JbmNyZW1lbnQ6IHByaW1LZXkuYXV0byB9IDogeyBhdXRvSW5jcmVtZW50OiBwcmltS2V5LmF1dG8gfSk7XHJcbiAgICAgICAgICAgIGluZGV4ZXMuZm9yRWFjaChmdW5jdGlvbiAoaWR4KSB7IGFkZEluZGV4KHN0b3JlLCBpZHgpOyB9KTtcclxuICAgICAgICAgICAgcmV0dXJuIHN0b3JlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gY3JlYXRlTWlzc2luZ1RhYmxlcyhuZXdTY2hlbWEsIGlkYnRyYW5zKSB7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG5ld1NjaGVtYSkuZm9yRWFjaChmdW5jdGlvbiAodGFibGVOYW1lKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWlkYnRyYW5zLmRiLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnModGFibGVOYW1lKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZVRhYmxlKGlkYnRyYW5zLCB0YWJsZU5hbWUsIG5ld1NjaGVtYVt0YWJsZU5hbWVdLnByaW1LZXksIG5ld1NjaGVtYVt0YWJsZU5hbWVdLmluZGV4ZXMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIGRlbGV0ZVJlbW92ZWRUYWJsZXMobmV3U2NoZW1hLCBpZGJ0cmFucykge1xyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGlkYnRyYW5zLmRiLm9iamVjdFN0b3JlTmFtZXMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgIHZhciBzdG9yZU5hbWUgPSBpZGJ0cmFucy5kYi5vYmplY3RTdG9yZU5hbWVzW2ldO1xyXG4gICAgICAgICAgICAgICAgaWYgKG5ld1NjaGVtYVtzdG9yZU5hbWVdID09PSBudWxsIHx8IG5ld1NjaGVtYVtzdG9yZU5hbWVdID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZGJ0cmFucy5kYi5kZWxldGVPYmplY3RTdG9yZShzdG9yZU5hbWUpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBhZGRJbmRleChzdG9yZSwgaWR4KSB7XHJcbiAgICAgICAgICAgIHN0b3JlLmNyZWF0ZUluZGV4KGlkeC5uYW1lLCBpZHgua2V5UGF0aCwgeyB1bmlxdWU6IGlkeC51bmlxdWUsIG11bHRpRW50cnk6IGlkeC5tdWx0aSB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyAgICAgIERleGllIFByb3RlY3RlZCBBUElcclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcblxyXG4gICAgICAgIHRoaXMuX2FsbFRhYmxlcyA9IGFsbFRhYmxlcztcclxuXHJcbiAgICAgICAgdGhpcy5fdGFibGVGYWN0b3J5ID0gZnVuY3Rpb24gY3JlYXRlVGFibGUobW9kZSwgdGFibGVTY2hlbWEsIHRyYW5zYWN0aW9uUHJvbWlzZUZhY3RvcnkpIHtcclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwidGFibGVTY2hlbWFcIiB0eXBlPVwiVGFibGVTY2hlbWFcIj48L3BhcmFtPlxyXG4gICAgICAgICAgICBpZiAobW9kZSA9PT0gUkVBRE9OTFkpXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFRhYmxlKHRhYmxlU2NoZW1hLm5hbWUsIHRyYW5zYWN0aW9uUHJvbWlzZUZhY3RvcnksIHRhYmxlU2NoZW1hLCBDb2xsZWN0aW9uKTtcclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBXcml0ZWFibGVUYWJsZSh0YWJsZVNjaGVtYS5uYW1lLCB0cmFuc2FjdGlvblByb21pc2VGYWN0b3J5LCB0YWJsZVNjaGVtYSk7XHJcbiAgICAgICAgfTsgXHJcblxyXG4gICAgICAgIHRoaXMuX2NyZWF0ZVRyYW5zYWN0aW9uID0gZnVuY3Rpb24gKG1vZGUsIHN0b3JlTmFtZXMsIGRic2NoZW1hLCBwYXJlbnRUcmFuc2FjdGlvbikge1xyXG4gICAgICAgICAgICByZXR1cm4gbmV3IFRyYW5zYWN0aW9uKG1vZGUsIHN0b3JlTmFtZXMsIGRic2NoZW1hLCBwYXJlbnRUcmFuc2FjdGlvbik7XHJcbiAgICAgICAgfTsgXHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHRhYmxlTm90SW5UcmFuc2FjdGlvbihtb2RlLCBzdG9yZU5hbWVzKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRhYmxlIFwiICsgc3RvcmVOYW1lc1swXSArIFwiIG5vdCBwYXJ0IG9mIHRyYW5zYWN0aW9uLiBPcmlnaW5hbCBTY29wZSBGdW5jdGlvbiBTb3VyY2U6IFwiICsgRGV4aWUuUHJvbWlzZS5QU0QudHJhbnMuc2NvcGVGdW5jLnRvU3RyaW5nKCkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy5fdHJhbnNQcm9taXNlRmFjdG9yeSA9IGZ1bmN0aW9uIHRyYW5zYWN0aW9uUHJvbWlzZUZhY3RvcnkobW9kZSwgc3RvcmVOYW1lcywgZm4pIHsgLy8gTGFzdCBhcmd1bWVudCBpcyBcIndyaXRlTG9ja2VkXCIuIEJ1dCB0aGlzIGRvZXNudCBhcHBseSB0byBvbmVzaG90IGRpcmVjdCBkYiBvcGVyYXRpb25zLCBzbyB3ZSBpZ25vcmUgaXQuXHJcbiAgICAgICAgICAgIGlmIChkYl9pc19ibG9ja2VkICYmICghUHJvbWlzZS5QU0QgfHwgIVByb21pc2UuUFNELmxldFRocm91Z2gpKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBEYXRhYmFzZSBpcyBwYXVzZWQuIFdhaXQgdGlsIHJlc3VtZWQuXHJcbiAgICAgICAgICAgICAgICB2YXIgYmxvY2tlZFByb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcGF1c2VkUmVzdW1lYWJsZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VtZTogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHAgPSBkYi5fdHJhbnNQcm9taXNlRmFjdG9yeShtb2RlLCBzdG9yZU5hbWVzLCBmbik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBibG9ja2VkUHJvbWlzZS5vbnVuY2F0Y2hlZCA9IHAub251bmNhdGNoZWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYmxvY2tlZFByb21pc2U7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgdHJhbnMgPSBkYi5fY3JlYXRlVHJhbnNhY3Rpb24obW9kZSwgc3RvcmVOYW1lcywgZ2xvYmFsU2NoZW1hKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB0cmFucy5fcHJvbWlzZShtb2RlLCBmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQW4gdW5jYXRjaGVkIG9wZXJhdGlvbiB3aWxsIGJ1YmJsZSB0byB0aGlzIGFub255bW91cyB0cmFuc2FjdGlvbi4gTWFrZSBzdXJlXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gdG8gY29udGludWUgYnViYmxpbmcgaXQgdXAgdG8gZGIub24oJ2Vycm9yJyk6XHJcbiAgICAgICAgICAgICAgICAgICAgdHJhbnMuZXJyb3IoZnVuY3Rpb24gKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkYi5vbignZXJyb3InKS5maXJlKGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgZm4oZnVuY3Rpb24gKHZhbHVlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEluc3RlYWQgb2YgcmVzb2x2aW5nIHZhbHVlIGRpcmVjdGx5LCB3YWl0IHdpdGggcmVzb2x2aW5nIGl0IHVudGlsIHRyYW5zYWN0aW9uIGhhcyBjb21wbGV0ZWQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIE90aGVyd2lzZSB0aGUgZGF0YSB3b3VsZCBub3QgYmUgaW4gdGhlIERCIGlmIHJlcXVlc3RpbmcgaXQgaW4gdGhlIHRoZW4oKSBvcGVyYXRpb24uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFNwZWNpZmljYWxseSwgdG8gZW5zdXJlIHRoYXQgdGhlIGZvbGxvd2luZyBleHByZXNzaW9uIHdpbGwgd29yazpcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy9cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gICBkYi5mcmllbmRzLnB1dCh7bmFtZTogXCJBcm5lXCJ9KS50aGVuKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gICAgICAgZGIuZnJpZW5kcy53aGVyZShcIm5hbWVcIikuZXF1YWxzKFwiQXJuZVwiKS5jb3VudChmdW5jdGlvbihjb3VudCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyAgICAgICAgICAgYXNzZXJ0IChjb3VudCA9PT0gMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvL1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFucy5jb21wbGV0ZShmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHZhbHVlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSwgcmVqZWN0LCB0cmFucyk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07IFxyXG5cclxuICAgICAgICB0aGlzLl93aGVuUmVhZHkgPSBmdW5jdGlvbiAoZm4pIHtcclxuICAgICAgICAgICAgaWYgKGRiX2lzX2Jsb2NrZWQgJiYgKCFQcm9taXNlLlBTRCB8fCAhUHJvbWlzZS5QU0QubGV0VGhyb3VnaCkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcGF1c2VkUmVzdW1lYWJsZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VtZTogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm4ocmVzb2x2ZSwgcmVqZWN0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZuKTtcclxuICAgICAgICB9OyBcclxuXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyAgICAgIERleGllIEFQSVxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG5cclxuICAgICAgICB0aGlzLnZlcm5vID0gMDtcclxuXHJcbiAgICAgICAgdGhpcy5vcGVuID0gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGlkYmRiIHx8IGlzQmVpbmdPcGVuZWQpIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIGFscmVhZHkgb3BlbmVkIG9yIGJlaW5nIG9wZW5lZFwiKTtcclxuICAgICAgICAgICAgICAgIHZhciByZXEsIGRiV2FzQ3JlYXRlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgZnVuY3Rpb24gb3BlbkVycm9yKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7IHJlcS50cmFuc2FjdGlvbi5hYm9ydCgpOyB9IGNhdGNoIChlKSB7IH1cclxuICAgICAgICAgICAgICAgICAgICAvKmlmIChkYldhc0NyZWF0ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gV29ya2Fyb3VuZCBmb3IgaXNzdWUgd2l0aCBzb21lIGJyb3dzZXJzLiBTZWVtIG5vdCB0byBiZSBuZWVkZWQgdGhvdWdoLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBVbml0IHRlc3QgXCJJc3N1ZSMxMDAgLSBub3QgYWxsIGluZGV4ZXMgYXJlIGNyZWF0ZWRcIiB3b3JrcyB3aXRob3V0IGl0IG9uIGNocm9tZSxGRixvcGVyYSBhbmQgSUUuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkYmRiLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4ZWREQi5kZWxldGVEYXRhYmFzZShkYi5uYW1lKTsgXHJcbiAgICAgICAgICAgICAgICAgICAgfSovXHJcbiAgICAgICAgICAgICAgICAgICAgaXNCZWluZ09wZW5lZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIGRiT3BlbkVycm9yID0gZXJyO1xyXG4gICAgICAgICAgICAgICAgICAgIGRiX2lzX2Jsb2NrZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QoZGJPcGVuRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgIHBhdXNlZFJlc3VtZWFibGVzLmZvckVhY2goZnVuY3Rpb24gKHJlc3VtYWJsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZXN1bWUgYWxsIHN0YWxsZWQgb3BlcmF0aW9ucy4gVGhleSB3aWxsIGZhaWwgb25jZSB0aGV5IHdha2UgdXAuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VtYWJsZS5yZXN1bWUoKTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBwYXVzZWRSZXN1bWVhYmxlcyA9IFtdO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBkYk9wZW5FcnJvciA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgaXNCZWluZ09wZW5lZCA9IHRydWU7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIE1ha2Ugc3VyZSBjYWxsZXIgaGFzIHNwZWNpZmllZCBhdCBsZWFzdCBvbmUgdmVyc2lvblxyXG4gICAgICAgICAgICAgICAgICAgIGlmICh2ZXJzaW9ucy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXV0b1NjaGVtYSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBNdWx0aXBseSBkYi52ZXJubyB3aXRoIDEwIHdpbGwgYmUgbmVlZGVkIHRvIHdvcmthcm91bmQgdXBncmFkaW5nIGJ1ZyBpbiBJRTogXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSUUgZmFpbHMgd2hlbiBkZWxldGluZyBvYmplY3RTdG9yZSBhZnRlciByZWFkaW5nIGZyb20gaXQuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQSBmdXR1cmUgdmVyc2lvbiBvZiBEZXhpZS5qcyB3aWxsIHN0b3BvdmVyIGFuIGludGVybWVkaWF0ZSB2ZXJzaW9uIHRvIHdvcmthcm91bmQgdGhpcy5cclxuICAgICAgICAgICAgICAgICAgICAvLyBBdCB0aGF0IHBvaW50LCB3ZSB3YW50IHRvIGJlIGJhY2t3YXJkIGNvbXBhdGlibGUuIENvdWxkIGhhdmUgYmVlbiBtdWx0aXBsaWVkIHdpdGggMiwgYnV0IGJ5IHVzaW5nIDEwLCBpdCBpcyBlYXNpZXIgdG8gbWFwIHRoZSBudW1iZXIgdG8gdGhlIHJlYWwgdmVyc2lvbiBudW1iZXIuXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFpbmRleGVkREIpIHRocm93IG5ldyBFcnJvcihcImluZGV4ZWREQiBBUEkgbm90IGZvdW5kLiBJZiB1c2luZyBJRTEwKywgbWFrZSBzdXJlIHRvIHJ1biB5b3VyIGNvZGUgb24gYSBzZXJ2ZXIgVVJMIChub3QgbG9jYWxseSkuIElmIHVzaW5nIFNhZmFyaSwgbWFrZSBzdXJlIHRvIGluY2x1ZGUgaW5kZXhlZERCIHBvbHlmaWxsLlwiKTtcclxuICAgICAgICAgICAgICAgICAgICByZXEgPSBhdXRvU2NoZW1hID8gaW5kZXhlZERCLm9wZW4oZGJOYW1lKSA6IGluZGV4ZWREQi5vcGVuKGRiTmFtZSwgTWF0aC5yb3VuZChkYi52ZXJubyAqIDEwKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVxLm9uZXJyb3IgPSBldmVudFJlamVjdEhhbmRsZXIob3BlbkVycm9yLCBbXCJvcGVuaW5nIGRhdGFiYXNlXCIsIGRiTmFtZV0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlcS5vbmJsb2NrZWQgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGIub24oXCJibG9ja2VkXCIpLmZpcmUoZXYpO1xyXG4gICAgICAgICAgICAgICAgICAgIH07IFxyXG4gICAgICAgICAgICAgICAgICAgIHJlcS5vbnVwZ3JhZGVuZWVkZWQgPSB0cnljYXRjaCAoZnVuY3Rpb24gKGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGF1dG9TY2hlbWEgJiYgIWRiLl9hbGxvd0VtcHR5REIpIHsgLy8gVW5sZXNzIGFuIGFkZG9uIGhhcyBzcGVjaWZpZWQgZGIuX2FsbG93RW1wdHlEQiwgbGV0cyBtYWtlIHRoZSBjYWxsIGZhaWwuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBDYWxsZXIgZGlkIG5vdCBzcGVjaWZ5IGEgdmVyc2lvbiBvciBzY2hlbWEuIERvaW5nIHRoYXQgaXMgb25seSBhY2NlcHRhYmxlIGZvciBvcGVuaW5nIGFscmVhZCBleGlzdGluZyBkYXRhYmFzZXMuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBJZiBvbnVwZ3JhZGVuZWVkZWQgaXMgY2FsbGVkIGl0IG1lYW5zIGRhdGFiYXNlIGRpZCBub3QgZXhpc3QuIFJlamVjdCB0aGUgb3BlbigpIHByb21pc2UgYW5kIG1ha2Ugc3VyZSB0aGF0IHdlIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZG8gbm90IGNyZWF0ZSBhIG5ldyBkYXRhYmFzZSBieSBhY2NpZGVudCBoZXJlLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxLm9uZXJyb3IgPSBmdW5jdGlvbiAoZXZlbnQpIHsgZXZlbnQucHJldmVudERlZmF1bHQoKTsgfTsgLy8gUHJvaGliaXQgb25hYm9ydCBlcnJvciBmcm9tIGZpcmluZyBiZWZvcmUgd2UncmUgZG9uZSFcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcS50cmFuc2FjdGlvbi5hYm9ydCgpOyAvLyBBYm9ydCB0cmFuc2FjdGlvbiAod291bGQgaG9wZSB0aGF0IHRoaXMgd291bGQgbWFrZSBEQiBkaXNhcHBlYXIgYnV0IGl0IGRvZXNudC4pXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBDbG9zZSBkYXRhYmFzZSBhbmQgZGVsZXRlIGl0LlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxLnJlc3VsdC5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGRlbHJlcSA9IGluZGV4ZWREQi5kZWxldGVEYXRhYmFzZShkYk5hbWUpOyAvLyBUaGUgdXBncmFkZSB0cmFuc2FjdGlvbiBpcyBhdG9taWMsIGFuZCBqYXZhc2NyaXB0IGlzIHNpbmdsZSB0aHJlYWRlZCAtIG1lYW5pbmcgdGhhdCB0aGVyZSBpcyBubyByaXNrIHRoYXQgd2UgZGVsZXRlIHNvbWVvbmUgZWxzZXMgZGF0YWJhc2UgaGVyZSFcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlbHJlcS5vbnN1Y2Nlc3MgPSBkZWxyZXEub25lcnJvciA9IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcGVuRXJyb3IobmV3IEVycm9yKFwiRGF0YWJhc2UgJ1wiICsgZGJOYW1lICsgXCInIGRvZXNudCBleGlzdFwiKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9OyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlLm9sZFZlcnNpb24gPT09IDApIGRiV2FzQ3JlYXRlZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXEudHJhbnNhY3Rpb24ub25lcnJvciA9IGV2ZW50UmVqZWN0SGFuZGxlcihvcGVuRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIG9sZFZlciA9IGUub2xkVmVyc2lvbiA+IE1hdGgucG93KDIsIDYyKSA/IDAgOiBlLm9sZFZlcnNpb247IC8vIFNhZmFyaSA4IGZpeC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJ1blVwZ3JhZGVycyhvbGRWZXIgLyAxMCwgcmVxLnRyYW5zYWN0aW9uLCBvcGVuRXJyb3IsIHJlcSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9LCBvcGVuRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSB0cnljYXRjaChmdW5jdGlvbiAoZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpc0JlaW5nT3BlbmVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkYmRiID0gcmVxLnJlc3VsdDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGF1dG9TY2hlbWEpIHJlYWRHbG9iYWxTY2hlbWEoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoaWRiZGIub2JqZWN0U3RvcmVOYW1lcy5sZW5ndGggPiAwKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWRqdXN0VG9FeGlzdGluZ0luZGV4TmFtZXMoZ2xvYmFsU2NoZW1hLCBpZGJkYi50cmFuc2FjdGlvbihzYWZhcmlNdWx0aVN0b3JlRml4KGlkYmRiLm9iamVjdFN0b3JlTmFtZXMpLCBSRUFET05MWSkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZGJkYi5vbnZlcnNpb25jaGFuZ2UgPSBkYi5vbihcInZlcnNpb25jaGFuZ2VcIikuZmlyZTsgLy8gTm90IGZpcmluZyBpdCBoZXJlLCBqdXN0IHNldHRpbmcgdGhlIGZ1bmN0aW9uIGNhbGxiYWNrIHRvIGFueSByZWdpc3RlcmVkIHN1YnNjcmliZXIuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghaGFzTmF0aXZlR2V0RGF0YWJhc2VOYW1lcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXBkYXRlIGxvY2FsU3RvcmFnZSB3aXRoIGxpc3Qgb2YgZGF0YWJhc2UgbmFtZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdsb2JhbERhdGFiYXNlTGlzdChmdW5jdGlvbiAoZGF0YWJhc2VOYW1lcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChkYXRhYmFzZU5hbWVzLmluZGV4T2YoZGJOYW1lKSA9PT0gLTEpIHJldHVybiBkYXRhYmFzZU5hbWVzLnB1c2goZGJOYW1lKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIE5vdywgbGV0IGFueSBzdWJzY3JpYmVycyB0byB0aGUgb24oXCJyZWFkeVwiKSBmaXJlIEJFRk9SRSBhbnkgb3RoZXIgZGIgb3BlcmF0aW9ucyByZXN1bWUhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIElmIGFuIHRoZSBvbihcInJlYWR5XCIpIHN1YnNjcmliZXIgcmV0dXJucyBhIFByb21pc2UsIHdlIHdpbGwgd2FpdCB0aWwgcHJvbWlzZSBjb21wbGV0ZXMgb3IgcmVqZWN0cyBiZWZvcmUgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFByb21pc2UubmV3UFNEKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFByb21pc2UuUFNELmxldFRocm91Z2ggPSB0cnVlOyAvLyBTZXQgYSBQcm9taXNlLVNwZWNpZmljIERhdGEgcHJvcGVydHkgaW5mb3JtaW5nIHRoYXQgb25yZWFkeSBpcyBmaXJpbmcuIFRoaXMgd2lsbCBtYWtlIGRiLl93aGVuUmVhZHkoKSBsZXQgdGhlIHN1YnNjcmliZXJzIHVzZSB0aGUgREIgYnV0IGJsb2NrIGFsbCBvdGhlcnMgKCEpLiBRdWl0ZSBjb29sIGhhP1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVzID0gZGIub24ucmVhZHkuZmlyZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXMgJiYgdHlwZW9mIHJlcy50aGVuID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIElmIG9uKCdyZWFkeScpIHJldHVybnMgYSBwcm9taXNlLCB3YWl0IGZvciBpdCB0byBjb21wbGV0ZSBhbmQgdGhlbiByZXN1bWUgYW55IHBlbmRpbmcgb3BlcmF0aW9ucy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzLnRoZW4ocmVzdW1lLCBmdW5jdGlvbiAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZGJkYi5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWRiZGIgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3BlbkVycm9yKGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFzYXAocmVzdW1lKTsgLy8gQ2Fubm90IGNhbGwgcmVzdW1lIGRpcmVjdGx5IGJlY2F1c2UgdGhlbiB0aGUgcGF1c2VSZXN1bWFibGVzIHdvdWxkIGluaGVyaXQgZnJvbSBvdXIgUFNEIHNjb3BlLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcGVuRXJyb3IoZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb24gcmVzdW1lKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRiX2lzX2Jsb2NrZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXVzZWRSZXN1bWVhYmxlcy5mb3JFYWNoKGZ1bmN0aW9uIChyZXN1bWFibGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gSWYgYW55b25lIGhhcyBtYWRlIG9wZXJhdGlvbnMgb24gYSB0YWJsZSBpbnN0YW5jZSBiZWZvcmUgdGhlIGRiIHdhcyBvcGVuZWQsIHRoZSBvcGVyYXRpb25zIHdpbGwgc3RhcnQgZXhlY3V0aW5nIG5vdy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdW1hYmxlLnJlc3VtZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdXNlZFJlc3VtZWFibGVzID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShkYik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sIG9wZW5FcnJvcik7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICBvcGVuRXJyb3IoZXJyKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfTsgXHJcblxyXG4gICAgICAgIHRoaXMuY2xvc2UgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGlmIChpZGJkYikge1xyXG4gICAgICAgICAgICAgICAgaWRiZGIuY2xvc2UoKTtcclxuICAgICAgICAgICAgICAgIGlkYmRiID0gbnVsbDtcclxuICAgICAgICAgICAgICAgIGRiX2lzX2Jsb2NrZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgZGJPcGVuRXJyb3IgPSBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTsgXHJcblxyXG4gICAgICAgIHRoaXMuZGVsZXRlID0gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcclxuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgICAgIGlmIChhcmdzLmxlbmd0aCA+IDApIHRocm93IG5ldyBFcnJvcihcIkFyZ3VtZW50cyBub3QgYWxsb3dlZCBpbiBkYi5kZWxldGUoKVwiKTtcclxuICAgICAgICAgICAgICAgIGZ1bmN0aW9uIGRvRGVsZXRlKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGRiLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJlcSA9IGluZGV4ZWREQi5kZWxldGVEYXRhYmFzZShkYk5hbWUpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghaGFzTmF0aXZlR2V0RGF0YWJhc2VOYW1lcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2xvYmFsRGF0YWJhc2VMaXN0KGZ1bmN0aW9uKGRhdGFiYXNlTmFtZXMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcG9zID0gZGF0YWJhc2VOYW1lcy5pbmRleE9mKGRiTmFtZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBvcyA+PSAwKSByZXR1cm4gZGF0YWJhc2VOYW1lcy5zcGxpY2UocG9zLCAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgIHJlcS5vbmVycm9yID0gZXZlbnRSZWplY3RIYW5kbGVyKHJlamVjdCwgW1wiZGVsZXRpbmdcIiwgZGJOYW1lXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVxLm9uYmxvY2tlZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkYi5vbihcImJsb2NrZWRcIikuZmlyZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNCZWluZ09wZW5lZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHBhdXNlZFJlc3VtZWFibGVzLnB1c2goeyByZXN1bWU6IGRvRGVsZXRlIH0pO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBkb0RlbGV0ZSgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9OyBcclxuXHJcbiAgICAgICAgdGhpcy5iYWNrZW5kREIgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBpZGJkYjtcclxuICAgICAgICB9OyBcclxuXHJcbiAgICAgICAgdGhpcy5pc09wZW4gPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBpZGJkYiAhPT0gbnVsbDtcclxuICAgICAgICB9OyBcclxuICAgICAgICB0aGlzLmhhc0ZhaWxlZCA9IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGRiT3BlbkVycm9yICE9PSBudWxsO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgdGhpcy5keW5hbWljYWxseU9wZW5lZCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gYXV0b1NjaGVtYTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8qdGhpcy5kYmcgPSBmdW5jdGlvbiAoY29sbGVjdGlvbiwgY291bnRlcikge1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuX2RiZ1Jlc3VsdCB8fCAhdGhpcy5fZGJnUmVzdWx0W2NvdW50ZXJdKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGNvbGxlY3Rpb24gPT09ICdzdHJpbmcnKSBjb2xsZWN0aW9uID0gdGhpcy50YWJsZShjb2xsZWN0aW9uKS50b0NvbGxlY3Rpb24oKS5saW1pdCgxMDApO1xyXG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLl9kYmdSZXN1bHQpIHRoaXMuX2RiZ1Jlc3VsdCA9IFtdO1xyXG4gICAgICAgICAgICAgICAgdmFyIGRiID0gdGhpcztcclxuICAgICAgICAgICAgICAgIG5ldyBQcm9taXNlKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICBQcm9taXNlLlBTRC5sZXRUaHJvdWdoID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICBkYi5fZGJnUmVzdWx0W2NvdW50ZXJdID0gY29sbGVjdGlvbi50b0FycmF5KCk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fZGJnUmVzdWx0W2NvdW50ZXJdLl92YWx1ZTtcclxuICAgICAgICB9Ki9cclxuXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyBQcm9wZXJ0aWVzXHJcbiAgICAgICAgLy9cclxuICAgICAgICB0aGlzLm5hbWUgPSBkYk5hbWU7XHJcblxyXG4gICAgICAgIC8vIGRiLnRhYmxlcyAtIGFuIGFycmF5IG9mIGFsbCBUYWJsZSBpbnN0YW5jZXMuXHJcbiAgICAgICAgLy8gVE9ETzogQ2hhbmdlIHNvIHRoYXQgdGFibGVzIGlzIGEgc2ltcGxlIG1lbWJlciBhbmQgbWFrZSBzdXJlIHRvIHVwZGF0ZSBpdCB3aGVuZXZlciBhbGxUYWJsZXMgY2hhbmdlcy5cclxuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgXCJ0YWJsZXNcIiwge1xyXG4gICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgIC8vLyA8cmV0dXJucyB0eXBlPVwiQXJyYXlcIiBlbGVtZW50VHlwZT1cIldyaXRlYWJsZVRhYmxlXCIgLz5cclxuICAgICAgICAgICAgICAgIHJldHVybiBPYmplY3Qua2V5cyhhbGxUYWJsZXMpLm1hcChmdW5jdGlvbiAobmFtZSkgeyByZXR1cm4gYWxsVGFibGVzW25hbWVdOyB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIEV2ZW50c1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgdGhpcy5vbiA9IGV2ZW50cyh0aGlzLCBcImVycm9yXCIsIFwicG9wdWxhdGVcIiwgXCJibG9ja2VkXCIsIHsgXCJyZWFkeVwiOiBbcHJvbWlzYWJsZUNoYWluLCBub3BdLCBcInZlcnNpb25jaGFuZ2VcIjogW3JldmVyc2VTdG9wcGFibGVFdmVudENoYWluLCBub3BdIH0pO1xyXG5cclxuICAgICAgICAvLyBIYW5kbGUgb24oJ3JlYWR5Jykgc3BlY2lmaWNhbGx5OiBJZiBEQiBpcyBhbHJlYWR5IG9wZW4sIHRyaWdnZXIgdGhlIGV2ZW50IGltbWVkaWF0ZWx5LiBBbHNvLCBkZWZhdWx0IHRvIHVuc3Vic2NyaWJlIGltbWVkaWF0ZWx5IGFmdGVyIGJlaW5nIHRyaWdnZXJlZC5cclxuICAgICAgICB0aGlzLm9uLnJlYWR5LnN1YnNjcmliZSA9IG92ZXJyaWRlKHRoaXMub24ucmVhZHkuc3Vic2NyaWJlLCBmdW5jdGlvbiAob3JpZ1N1YnNjcmliZSkge1xyXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHN1YnNjcmliZXIsIGJTdGlja3kpIHtcclxuICAgICAgICAgICAgICAgIGZ1bmN0aW9uIHByb3h5ICgpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWJTdGlja3kpIGRiLm9uLnJlYWR5LnVuc3Vic2NyaWJlKHByb3h5KTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gc3Vic2NyaWJlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgb3JpZ1N1YnNjcmliZS5jYWxsKHRoaXMsIHByb3h5KTtcclxuICAgICAgICAgICAgICAgIGlmIChkYi5pc09wZW4oKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChkYl9pc19ibG9ja2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdXNlZFJlc3VtZWFibGVzLnB1c2goeyByZXN1bWU6IHByb3h5IH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHByb3h5KCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBmYWtlQXV0b0NvbXBsZXRlKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgZGIub24oXCJwb3B1bGF0ZVwiKS5maXJlKGRiLl9jcmVhdGVUcmFuc2FjdGlvbihSRUFEV1JJVEUsIGRiU3RvcmVOYW1lcywgZ2xvYmFsU2NoZW1hKSk7XHJcbiAgICAgICAgICAgIGRiLm9uKFwiZXJyb3JcIikuZmlyZShuZXcgRXJyb3IoKSk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHRoaXMudHJhbnNhY3Rpb24gPSBmdW5jdGlvbiAobW9kZSwgdGFibGVJbnN0YW5jZXMsIHNjb3BlRnVuYykge1xyXG4gICAgICAgICAgICAvLy8gPHN1bW1hcnk+XHJcbiAgICAgICAgICAgIC8vLyBcclxuICAgICAgICAgICAgLy8vIDwvc3VtbWFyeT5cclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwibW9kZVwiIHR5cGU9XCJTdHJpbmdcIj5cInJcIiBmb3IgcmVhZG9ubHksIG9yIFwicndcIiBmb3IgcmVhZHdyaXRlPC9wYXJhbT5cclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwidGFibGVJbnN0YW5jZXNcIj5UYWJsZSBpbnN0YW5jZSwgQXJyYXkgb2YgVGFibGUgaW5zdGFuY2VzLCBTdHJpbmcgb3IgU3RyaW5nIEFycmF5IG9mIG9iamVjdCBzdG9yZXMgdG8gaW5jbHVkZSBpbiB0aGUgdHJhbnNhY3Rpb248L3BhcmFtPlxyXG4gICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJzY29wZUZ1bmNcIiB0eXBlPVwiRnVuY3Rpb25cIj5GdW5jdGlvbiB0byBleGVjdXRlIHdpdGggdHJhbnNhY3Rpb248L3BhcmFtPlxyXG5cclxuICAgICAgICAgICAgLy8gTGV0IHRhYmxlIGFyZ3VtZW50cyBiZSBhbGwgYXJndW1lbnRzIGJldHdlZW4gbW9kZSBhbmQgbGFzdCBhcmd1bWVudC5cclxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZXMgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSwgYXJndW1lbnRzLmxlbmd0aCAtIDEpO1xyXG4gICAgICAgICAgICAvLyBMZXQgc2NvcGVGdW5jIGJlIHRoZSBsYXN0IGFyZ3VtZW50XHJcbiAgICAgICAgICAgIHNjb3BlRnVuYyA9IGFyZ3VtZW50c1thcmd1bWVudHMubGVuZ3RoIC0gMV07XHJcbiAgICAgICAgICAgIHZhciBwYXJlbnRUcmFuc2FjdGlvbiA9IFByb21pc2UuUFNEICYmIFByb21pc2UuUFNELnRyYW5zO1xyXG5cdFx0XHQvLyBDaGVjayBpZiBwYXJlbnQgdHJhbnNhY3Rpb25zIGlzIGJvdW5kIHRvIHRoaXMgZGIgaW5zdGFuY2UsIGFuZCBpZiBjYWxsZXIgd2FudHMgdG8gcmV1c2UgaXRcclxuICAgICAgICAgICAgaWYgKCFwYXJlbnRUcmFuc2FjdGlvbiB8fCBwYXJlbnRUcmFuc2FjdGlvbi5kYiAhPT0gZGIgfHwgbW9kZS5pbmRleE9mKCchJykgIT09IC0xKSBwYXJlbnRUcmFuc2FjdGlvbiA9IG51bGw7XHJcbiAgICAgICAgICAgIHZhciBvbmx5SWZDb21wYXRpYmxlID0gbW9kZS5pbmRleE9mKCc/JykgIT09IC0xO1xyXG4gICAgICAgICAgICBtb2RlID0gbW9kZS5yZXBsYWNlKCchJywgJycpLnJlcGxhY2UoJz8nLCAnJyk7XHJcbiAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgIC8vIEdldCBzdG9yZU5hbWVzIGZyb20gYXJndW1lbnRzLiBFaXRoZXIgdGhyb3VnaCBnaXZlbiB0YWJsZSBpbnN0YW5jZXMsIG9yIHRocm91Z2ggZ2l2ZW4gdGFibGUgbmFtZXMuXHJcbiAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgIHZhciB0YWJsZXMgPSBBcnJheS5pc0FycmF5KHRhYmxlSW5zdGFuY2VzWzBdKSA/IHRhYmxlSW5zdGFuY2VzLnJlZHVjZShmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYS5jb25jYXQoYik7IH0pIDogdGFibGVJbnN0YW5jZXM7XHJcbiAgICAgICAgICAgIHZhciBlcnJvciA9IG51bGw7XHJcbiAgICAgICAgICAgIHZhciBzdG9yZU5hbWVzID0gdGFibGVzLm1hcChmdW5jdGlvbiAodGFibGVJbnN0YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB0YWJsZUluc3RhbmNlID09PSBcInN0cmluZ1wiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRhYmxlSW5zdGFuY2U7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghKHRhYmxlSW5zdGFuY2UgaW5zdGFuY2VvZiBUYWJsZSkpIGVycm9yID0gZXJyb3IgfHwgbmV3IFR5cGVFcnJvcihcIkludmFsaWQgdHlwZS4gQXJndW1lbnRzIGZvbGxvd2luZyBtb2RlIG11c3QgYmUgaW5zdGFuY2VzIG9mIFRhYmxlIG9yIFN0cmluZ1wiKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGFibGVJbnN0YW5jZS5uYW1lO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgIC8vIFJlc29sdmUgbW9kZS4gQWxsb3cgc2hvcnRjdXRzIFwiclwiIGFuZCBcInJ3XCIuXHJcbiAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgIGlmIChtb2RlID09IFwiclwiIHx8IG1vZGUgPT0gUkVBRE9OTFkpXHJcbiAgICAgICAgICAgICAgICBtb2RlID0gUkVBRE9OTFk7XHJcbiAgICAgICAgICAgIGVsc2UgaWYgKG1vZGUgPT0gXCJyd1wiIHx8IG1vZGUgPT0gUkVBRFdSSVRFKVxyXG4gICAgICAgICAgICAgICAgbW9kZSA9IFJFQURXUklURTtcclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgZXJyb3IgPSBuZXcgRXJyb3IoXCJJbnZhbGlkIHRyYW5zYWN0aW9uIG1vZGU6IFwiICsgbW9kZSk7XHJcblxyXG4gICAgICAgICAgICBpZiAocGFyZW50VHJhbnNhY3Rpb24pIHtcclxuICAgICAgICAgICAgICAgIC8vIEJhc2ljIGNoZWNrc1xyXG4gICAgICAgICAgICAgICAgaWYgKCFlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChwYXJlbnRUcmFuc2FjdGlvbiAmJiBwYXJlbnRUcmFuc2FjdGlvbi5tb2RlID09PSBSRUFET05MWSAmJiBtb2RlID09PSBSRUFEV1JJVEUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9ubHlJZkNvbXBhdGlibGUpIHBhcmVudFRyYW5zYWN0aW9uID0gbnVsbDsgLy8gU3Bhd24gbmV3IHRyYW5zYWN0aW9uIGluc3RlYWQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgZXJyb3IgPSBlcnJvciB8fCBuZXcgRXJyb3IoXCJDYW5ub3QgZW50ZXIgYSBzdWItdHJhbnNhY3Rpb24gd2l0aCBSRUFEV1JJVEUgbW9kZSB3aGVuIHBhcmVudCB0cmFuc2FjdGlvbiBpcyBSRUFET05MWVwiKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhcmVudFRyYW5zYWN0aW9uKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0b3JlTmFtZXMuZm9yRWFjaChmdW5jdGlvbiAoc3RvcmVOYW1lKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXBhcmVudFRyYW5zYWN0aW9uLnRhYmxlcy5oYXNPd25Qcm9wZXJ0eShzdG9yZU5hbWUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9ubHlJZkNvbXBhdGlibGUpIHBhcmVudFRyYW5zYWN0aW9uID0gbnVsbDsgLy8gU3Bhd24gbmV3IHRyYW5zYWN0aW9uIGluc3RlYWQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBlcnJvciA9IGVycm9yIHx8IG5ldyBFcnJvcihcIlRhYmxlIFwiICsgc3RvcmVOYW1lICsgXCIgbm90IGluY2x1ZGVkIGluIHBhcmVudCB0cmFuc2FjdGlvbi4gUGFyZW50IFRyYW5zYWN0aW9uIGZ1bmN0aW9uOiBcIiArIHBhcmVudFRyYW5zYWN0aW9uLnNjb3BlRnVuYy50b1N0cmluZygpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChwYXJlbnRUcmFuc2FjdGlvbikge1xyXG4gICAgICAgICAgICAgICAgLy8gSWYgdGhpcyBpcyBhIHN1Yi10cmFuc2FjdGlvbiwgbG9jayB0aGUgcGFyZW50IGFuZCB0aGVuIGxhdW5jaCB0aGUgc3ViLXRyYW5zYWN0aW9uLlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHBhcmVudFRyYW5zYWN0aW9uLl9wcm9taXNlKG1vZGUsIGVudGVyVHJhbnNhY3Rpb25TY29wZSwgXCJsb2NrXCIpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgLy8gSWYgdGhpcyBpcyBhIHJvb3QtbGV2ZWwgdHJhbnNhY3Rpb24sIHdhaXQgdGlsIGRhdGFiYXNlIGlzIHJlYWR5IGFuZCB0aGVuIGxhdW5jaCB0aGUgdHJhbnNhY3Rpb24uXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZGIuX3doZW5SZWFkeShlbnRlclRyYW5zYWN0aW9uU2NvcGUpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBmdW5jdGlvbiBlbnRlclRyYW5zYWN0aW9uU2NvcGUocmVzb2x2ZSwgcmVqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICAvLyBPdXIgdHJhbnNhY3Rpb24uIFRvIGJlIHNldCBsYXRlci5cclxuICAgICAgICAgICAgICAgIHZhciB0cmFucyA9IG51bGw7XHJcblxyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBUaHJvdyBhbnkgZXJyb3IgaWYgYW55IG9mIHRoZSBhYm92ZSBjaGVja3MgZmFpbGVkLlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJlYWwgZXJyb3IgZGVmaW5lZCBzb21lIGxpbmVzIHVwLiBXZSB0aHJvdyBpdCBoZXJlIGZyb20gd2l0aGluIGEgUHJvbWlzZSB0byByZWplY3QgUHJvbWlzZVxyXG4gICAgICAgICAgICAgICAgICAgIC8vIHJhdGhlciB0aGFuIG1ha2UgY2FsbGVyIG5lZWQgdG8gYm90aCB1c2UgdHJ5Li5jYXRjaCBhbmQgcHJvbWlzZSBjYXRjaGluZy4gVGhlIHJlYXNvbiB3ZSBzdGlsbFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIHRocm93IGhlcmUgcmF0aGVyIHRoYW4gZG8gUHJvbWlzZS5yZWplY3QoZXJyb3IpIGlzIHRoYXQgd2UgbGlrZSB0byBoYXZlIHRoZSBzdGFjayBhdHRhY2hlZCB0byB0aGVcclxuICAgICAgICAgICAgICAgICAgICAvLyBlcnJvci4gQWxzbyBiZWNhdXNlIHRoZXJlIGlzIGEgY2F0Y2goKSBjbGF1c2UgYm91bmQgdG8gdGhpcyB0cnkoKSB0aGF0IHdpbGwgYnViYmxlIHRoZSBlcnJvclxyXG4gICAgICAgICAgICAgICAgICAgIC8vIHRvIHRoZSBwYXJlbnQgdHJhbnNhY3Rpb24uXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yKSB0aHJvdyBlcnJvcjtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy9cclxuICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgVHJhbnNhY3Rpb24gaW5zdGFuY2VcclxuICAgICAgICAgICAgICAgICAgICAvL1xyXG4gICAgICAgICAgICAgICAgICAgIHRyYW5zID0gZGIuX2NyZWF0ZVRyYW5zYWN0aW9uKG1vZGUsIHN0b3JlTmFtZXMsIGdsb2JhbFNjaGVtYSwgcGFyZW50VHJhbnNhY3Rpb24pO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBQcm92aWRlIGFyZ3VtZW50cyB0byB0aGUgc2NvcGUgZnVuY3Rpb24gKGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5KVxyXG4gICAgICAgICAgICAgICAgICAgIHZhciB0YWJsZUFyZ3MgPSBzdG9yZU5hbWVzLm1hcChmdW5jdGlvbiAobmFtZSkgeyByZXR1cm4gdHJhbnMudGFibGVzW25hbWVdOyB9KTtcclxuICAgICAgICAgICAgICAgICAgICB0YWJsZUFyZ3MucHVzaCh0cmFucyk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHRyYW5zYWN0aW9uIGNvbXBsZXRlcywgcmVzb2x2ZSB0aGUgUHJvbWlzZSB3aXRoIHRoZSByZXR1cm4gdmFsdWUgb2Ygc2NvcGVGdW5jLlxyXG4gICAgICAgICAgICAgICAgICAgIHZhciByZXR1cm5WYWx1ZTtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgdW5jb21wbGV0ZWRSZXF1ZXN0cyA9IDA7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIG5ldyBQU0QgZnJhbWUgdG8gaG9sZCBQcm9taXNlLlBTRC50cmFucy4gTXVzdCBub3QgYmUgYm91bmQgdG8gdGhlIGN1cnJlbnQgUFNEIGZyYW1lIHNpbmNlIHdlIHdhbnRcclxuICAgICAgICAgICAgICAgICAgICAvLyBpdCB0byBwb3AgYmVmb3JlIHRoZW4oKSBjYWxsYmFjayBpcyBjYWxsZWQgb2Ygb3VyIHJldHVybmVkIFByb21pc2UuXHJcbiAgICAgICAgICAgICAgICAgICAgUHJvbWlzZS5uZXdQU0QoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBMZXQgdGhlIHRyYW5zYWN0aW9uIGluc3RhbmNlIGJlIHBhcnQgb2YgYSBQcm9taXNlLXNwZWNpZmljIGRhdGEgKFBTRCkgdmFsdWUuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFByb21pc2UuUFNELnRyYW5zID0gdHJhbnM7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zLnNjb3BlRnVuYyA9IHNjb3BlRnVuYzsgLy8gRm9yIEVycm9yIChcIlRhYmxlIFwiICsgc3RvcmVOYW1lc1swXSArIFwiIG5vdCBwYXJ0IG9mIHRyYW5zYWN0aW9uXCIpIHdoZW4gaXQgaGFwcGVucy4gVGhpcyBtYXkgaGVscCBsb2NhbGl6aW5nIHRoZSBjb2RlIHRoYXQgc3RhcnRlZCBhIHRyYW5zYWN0aW9uIHVzZWQgb24gYW5vdGhlciBwbGFjZS5cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwYXJlbnRUcmFuc2FjdGlvbikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW11bGF0ZSB0cmFuc2FjdGlvbiBjb21taXQgYXdhcmVuZXNzIGZvciBpbm5lciB0cmFuc2FjdGlvbiAobXVzdCAnY29tbWl0JyB3aGVuIHRoZSBpbm5lciB0cmFuc2FjdGlvbiBoYXMgbm8gbW9yZSBvcGVyYXRpb25zIG9uZ29pbmcpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cmFucy5pZGJ0cmFucyA9IHBhcmVudFRyYW5zYWN0aW9uLmlkYnRyYW5zO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnMuX3Byb21pc2UgPSBvdmVycmlkZSh0cmFucy5fcHJvbWlzZSwgZnVuY3Rpb24gKG9yaWcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKG1vZGUsIGZuLCB3cml0ZUxvY2spIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKyt1bmNvbXBsZXRlZFJlcXVlc3RzO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvbiBwcm94eShmbjIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAodmFsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHJldHZhbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBfcm9vdEV4ZWMgbmVlZGVkIHNvIHRoYXQgd2UgZG8gbm90IGxvb3NlIGFueSBJREJUcmFuc2FjdGlvbiBpbiBhIHNldFRpbWVvdXQoKSBjYWxsLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFByb21pc2UuX3Jvb3RFeGVjKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dmFsID0gZm4yKHZhbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIF90aWNrRmluYWxpemUgbWFrZXMgc3VyZSB0byBzdXBwb3J0IGxhenkgbWljcm8gdGFza3MgZXhlY3V0ZWQgaW4gUHJvbWlzZS5fcm9vdEV4ZWMoKS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gV2UgY2VydGFpbmx5IGRvIG5vdCB3YW50IHRvIGNvcHkgdGhlIGJhZCBwYXR0ZXJuIGZyb20gSW5kZXhlZERCIGJ1dCBpbnN0ZWFkIGFsbG93XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGV4ZWN1dGlvbiBvZiBQcm9taXNlLnRoZW4oKSBjYWxsYmFja3MgdW50aWwgdGhlJ3JlIGFsbCBkb25lLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBQcm9taXNlLl90aWNrRmluYWxpemUoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKC0tdW5jb21wbGV0ZWRSZXF1ZXN0cyA9PT0gMCAmJiB0cmFucy5hY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cmFucy5hY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cmFucy5vbi5jb21wbGV0ZS5maXJlKCk7IC8vIEEgY2FsbGVkIGRiIG9wZXJhdGlvbiBoYXMgY29tcGxldGVkIHdpdGhvdXQgc3RhcnRpbmcgYSBuZXcgb3BlcmF0aW9uLiBUaGUgZmxvdyBpcyBmaW5pc2hlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmV0dmFsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBvcmlnLmNhbGwodGhpcywgbW9kZSwgZnVuY3Rpb24gKHJlc29sdmUyLCByZWplY3QyLCB0cmFucykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZuKHByb3h5KHJlc29sdmUyKSwgcHJveHkocmVqZWN0MiksIHRyYW5zKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwgd3JpdGVMb2NrKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnMuY29tcGxldGUoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXR1cm5WYWx1ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBJZiB0cmFuc2FjdGlvbiBmYWlscywgcmVqZWN0IHRoZSBQcm9taXNlIGFuZCBidWJibGUgdG8gZGIgaWYgbm9vbmUgY2F0Y2hlZCB0aGlzIHJlamVjdGlvbi5cclxuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnMuZXJyb3IoZnVuY3Rpb24gKGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0cmFucy5pZGJ0cmFucykgdHJhbnMuaWRidHJhbnMub25lcnJvciA9IHByZXZlbnREZWZhdWx0OyAvLyBQcm9oaWJpdCBBYm9ydEVycm9yIGZyb20gZmlyaW5nLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHt0cmFucy5hYm9ydCgpO30gY2F0Y2goZTIpe31cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwYXJlbnRUcmFuc2FjdGlvbikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmVudFRyYW5zYWN0aW9uLmFjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmVudFRyYW5zYWN0aW9uLm9uLmVycm9yLmZpcmUoZSk7IC8vIEJ1YmJsZSB0byBwYXJlbnQgdHJhbnNhY3Rpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBjYXRjaGVkID0gcmVqZWN0KGUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFwYXJlbnRUcmFuc2FjdGlvbiAmJiAhY2F0Y2hlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRiLm9uLmVycm9yLmZpcmUoZSk7Ly8gSWYgbm90IGNhdGNoZWQsIGJ1YmJsZSBlcnJvciB0byBkYi5vbihcImVycm9yXCIpLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZpbmFsbHksIGNhbGwgdGhlIHNjb3BlIGZ1bmN0aW9uIHdpdGggb3VyIHRhYmxlIGFuZCB0cmFuc2FjdGlvbiBhcmd1bWVudHMuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFByb21pc2UuX3Jvb3RFeGVjKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuVmFsdWUgPSBzY29wZUZ1bmMuYXBwbHkodHJhbnMsIHRhYmxlQXJncyk7IC8vIE5PVEU6IHJldHVyblZhbHVlIGlzIHVzZWQgaW4gdHJhbnMub24uY29tcGxldGUoKSBub3QgYXMgYSByZXR1cm5WYWx1ZSB0byB0aGlzIGZ1bmMuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghdHJhbnMuaWRidHJhbnMgfHwgKHBhcmVudFRyYW5zYWN0aW9uICYmIHVuY29tcGxldGVkUmVxdWVzdHMgPT09IDApKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zLl9ub3AoKTsgLy8gTWFrZSBzdXJlIHRyYW5zYWN0aW9uIGlzIGJlaW5nIHVzZWQgc28gdGhhdCBpdCB3aWxsIHJlc29sdmUuXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIElmIGV4Y2VwdGlvbiBvY2N1ciwgYWJvcnQgdGhlIHRyYW5zYWN0aW9uIGFuZCByZWplY3QgUHJvbWlzZS5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodHJhbnMgJiYgdHJhbnMuaWRidHJhbnMpIHRyYW5zLmlkYnRyYW5zLm9uZXJyb3IgPSBwcmV2ZW50RGVmYXVsdDsgLy8gUHJvaGliaXQgQWJvcnRFcnJvciBmcm9tIGZpcmluZy5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodHJhbnMpIHRyYW5zLmFib3J0KCk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhcmVudFRyYW5zYWN0aW9uKSBwYXJlbnRUcmFuc2FjdGlvbi5vbi5lcnJvci5maXJlKGUpO1xyXG4gICAgICAgICAgICAgICAgICAgIGFzYXAoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBOZWVkIHRvIHVzZSBhc2FwKD1zZXRJbW1lZGlhdGUvc2V0VGltZW91dCkgYmVmb3JlIGNhbGxpbmcgcmVqZWN0IGJlY2F1c2Ugd2UgYXJlIGluIHRoZSBQcm9taXNlIGNvbnN0cnVjdG9yIGFuZCByZWplY3QoKSB3aWxsIGFsd2F5cyByZXR1cm4gZmFsc2UgaWYgc28uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcmVqZWN0KGUpKSBkYi5vbihcImVycm9yXCIpLmZpcmUoZSk7IC8vIElmIG5vdCBjYXRjaGVkLCBidWJibGUgZXhjZXB0aW9uIHRvIGRiLm9uKFwiZXJyb3JcIik7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9OyBcclxuXHJcbiAgICAgICAgdGhpcy50YWJsZSA9IGZ1bmN0aW9uICh0YWJsZU5hbWUpIHtcclxuICAgICAgICAgICAgLy8vIDxyZXR1cm5zIHR5cGU9XCJXcml0ZWFibGVUYWJsZVwiPjwvcmV0dXJucz5cclxuICAgICAgICAgICAgaWYgKCFhdXRvU2NoZW1hICYmICFhbGxUYWJsZXMuaGFzT3duUHJvcGVydHkodGFibGVOYW1lKSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJUYWJsZSBkb2VzIG5vdCBleGlzdFwiKTsgcmV0dXJuIHsgQU5fVU5LTk9XTl9UQUJMRV9OQU1FX1dBU19TUEVDSUZJRUQ6IDEgfTsgfVxyXG4gICAgICAgICAgICByZXR1cm4gYWxsVGFibGVzW3RhYmxlTmFtZV07XHJcbiAgICAgICAgfTsgXHJcblxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIFRhYmxlIENsYXNzXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgZnVuY3Rpb24gVGFibGUobmFtZSwgdHJhbnNhY3Rpb25Qcm9taXNlRmFjdG9yeSwgdGFibGVTY2hlbWEsIGNvbGxDbGFzcykge1xyXG4gICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJuYW1lXCIgdHlwZT1cIlN0cmluZ1wiPjwvcGFyYW0+XHJcbiAgICAgICAgICAgIHRoaXMubmFtZSA9IG5hbWU7XHJcbiAgICAgICAgICAgIHRoaXMuc2NoZW1hID0gdGFibGVTY2hlbWE7XHJcbiAgICAgICAgICAgIHRoaXMuaG9vayA9IGFsbFRhYmxlc1tuYW1lXSA/IGFsbFRhYmxlc1tuYW1lXS5ob29rIDogZXZlbnRzKG51bGwsIHtcclxuICAgICAgICAgICAgICAgIFwiY3JlYXRpbmdcIjogW2hvb2tDcmVhdGluZ0NoYWluLCBub3BdLFxyXG4gICAgICAgICAgICAgICAgXCJyZWFkaW5nXCI6IFtwdXJlRnVuY3Rpb25DaGFpbiwgbWlycm9yXSxcclxuICAgICAgICAgICAgICAgIFwidXBkYXRpbmdcIjogW2hvb2tVcGRhdGluZ0NoYWluLCBub3BdLFxyXG4gICAgICAgICAgICAgICAgXCJkZWxldGluZ1wiOiBbbm9uU3RvcHBhYmxlRXZlbnRDaGFpbiwgbm9wXVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgdGhpcy5fdHBmID0gdHJhbnNhY3Rpb25Qcm9taXNlRmFjdG9yeTtcclxuICAgICAgICAgICAgdGhpcy5fY29sbENsYXNzID0gY29sbENsYXNzIHx8IENvbGxlY3Rpb247XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBleHRlbmQoVGFibGUucHJvdG90eXBlLCBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIGZhaWxSZWFkb25seSgpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkN1cnJlbnQgVHJhbnNhY3Rpb24gaXMgUkVBRE9OTFlcIik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgICAgICAvLyBUYWJsZSBQcm90ZWN0ZWQgTWV0aG9kc1xyXG4gICAgICAgICAgICAgICAgLy9cclxuXHJcbiAgICAgICAgICAgICAgICBfdHJhbnM6IGZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uKG1vZGUsIGZuLCB3cml0ZUxvY2tlZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLl90cGYobW9kZSwgW3RoaXMubmFtZV0sIGZuLCB3cml0ZUxvY2tlZCk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgX2lkYnN0b3JlOiBmdW5jdGlvbiBnZXRJREJPYmplY3RTdG9yZShtb2RlLCBmbiwgd3JpdGVMb2NrZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZmFrZSkgcmV0dXJuIG5ldyBQcm9taXNlKGZuKTsgLy8gU2ltcGxpZnkgdGhlIHdvcmsgZm9yIEludGVsbGlzZW5zZS9Db2RlIGNvbXBsZXRpb24uXHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLl90cGYobW9kZSwgW3RoaXMubmFtZV0sIGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QsIHRyYW5zKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZuKHJlc29sdmUsIHJlamVjdCwgdHJhbnMuaWRidHJhbnMub2JqZWN0U3RvcmUoc2VsZi5uYW1lKSwgdHJhbnMpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sIHdyaXRlTG9ja2VkKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcblxyXG4gICAgICAgICAgICAgICAgLy9cclxuICAgICAgICAgICAgICAgIC8vIFRhYmxlIFB1YmxpYyBNZXRob2RzXHJcbiAgICAgICAgICAgICAgICAvL1xyXG4gICAgICAgICAgICAgICAgZ2V0OiBmdW5jdGlvbiAoa2V5LCBjYikge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5faWRic3RvcmUoUkVBRE9OTFksIGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QsIGlkYnN0b3JlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZha2UgJiYgcmVzb2x2ZShzZWxmLnNjaGVtYS5pbnN0YW5jZVRlbXBsYXRlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHJlcSA9IGlkYnN0b3JlLmdldChrZXkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXEub25lcnJvciA9IGV2ZW50UmVqZWN0SGFuZGxlcihyZWplY3QsIFtcImdldHRpbmdcIiwga2V5LCBcImZyb21cIiwgc2VsZi5uYW1lXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHNlbGYuaG9vay5yZWFkaW5nLmZpcmUocmVxLnJlc3VsdCkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLnRoZW4oY2IpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHdoZXJlOiBmdW5jdGlvbiAoaW5kZXhOYW1lKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBXaGVyZUNsYXVzZSh0aGlzLCBpbmRleE5hbWUpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGNvdW50OiBmdW5jdGlvbiAoY2IpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy50b0NvbGxlY3Rpb24oKS5jb3VudChjYik7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgb2Zmc2V0OiBmdW5jdGlvbiAob2Zmc2V0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMudG9Db2xsZWN0aW9uKCkub2Zmc2V0KG9mZnNldCk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgbGltaXQ6IGZ1bmN0aW9uIChudW1Sb3dzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMudG9Db2xsZWN0aW9uKCkubGltaXQobnVtUm93cyk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgcmV2ZXJzZTogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnRvQ29sbGVjdGlvbigpLnJldmVyc2UoKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBmaWx0ZXI6IGZ1bmN0aW9uIChmaWx0ZXJGdW5jdGlvbikge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnRvQ29sbGVjdGlvbigpLmFuZChmaWx0ZXJGdW5jdGlvbik7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgZWFjaDogZnVuY3Rpb24gKGZuKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICAgICAgICAgIGZha2UgJiYgZm4oc2VsZi5zY2hlbWEuaW5zdGFuY2VUZW1wbGF0ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2lkYnN0b3JlKFJFQURPTkxZLCBmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0LCBpZGJzdG9yZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVxID0gaWRic3RvcmUub3BlbkN1cnNvcigpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXEub25lcnJvciA9IGV2ZW50UmVqZWN0SGFuZGxlcihyZWplY3QsIFtcImNhbGxpbmdcIiwgXCJUYWJsZS5lYWNoKClcIiwgXCJvblwiLCBzZWxmLm5hbWVdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaXRlcmF0ZShyZXEsIG51bGwsIGZuLCByZXNvbHZlLCByZWplY3QsIHNlbGYuaG9vay5yZWFkaW5nLmZpcmUpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHRvQXJyYXk6IGZ1bmN0aW9uIChjYikge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5faWRic3RvcmUoUkVBRE9OTFksIGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QsIGlkYnN0b3JlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZha2UgJiYgcmVzb2x2ZShbc2VsZi5zY2hlbWEuaW5zdGFuY2VUZW1wbGF0ZV0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgYSA9IFtdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVxID0gaWRic3RvcmUub3BlbkN1cnNvcigpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXEub25lcnJvciA9IGV2ZW50UmVqZWN0SGFuZGxlcihyZWplY3QsIFtcImNhbGxpbmdcIiwgXCJUYWJsZS50b0FycmF5KClcIiwgXCJvblwiLCBzZWxmLm5hbWVdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaXRlcmF0ZShyZXEsIG51bGwsIGZ1bmN0aW9uIChpdGVtKSB7IGEucHVzaChpdGVtKTsgfSwgZnVuY3Rpb24gKCkgeyByZXNvbHZlKGEpOyB9LCByZWplY3QsIHNlbGYuaG9vay5yZWFkaW5nLmZpcmUpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLnRoZW4oY2IpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIG9yZGVyQnk6IGZ1bmN0aW9uIChpbmRleCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5fY29sbENsYXNzKG5ldyBXaGVyZUNsYXVzZSh0aGlzLCBpbmRleCkpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICB0b0NvbGxlY3Rpb246IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IHRoaXMuX2NvbGxDbGFzcyhuZXcgV2hlcmVDbGF1c2UodGhpcykpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICBtYXBUb0NsYXNzOiBmdW5jdGlvbiAoY29uc3RydWN0b3IsIHN0cnVjdHVyZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8c3VtbWFyeT5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gICAgIE1hcCB0YWJsZSB0byBhIGphdmFzY3JpcHQgY29uc3RydWN0b3IgZnVuY3Rpb24uIE9iamVjdHMgcmV0dXJuZWQgZnJvbSB0aGUgZGF0YWJhc2Ugd2lsbCBiZSBpbnN0YW5jZXMgb2YgdGhpcyBjbGFzcywgbWFraW5nXHJcbiAgICAgICAgICAgICAgICAgICAgLy8vICAgICBpdCBwb3NzaWJsZSB0byB0aGUgaW5zdGFuY2VPZiBvcGVyYXRvciBhcyB3ZWxsIGFzIGV4dGVuZGluZyB0aGUgY2xhc3MgdXNpbmcgY29uc3RydWN0b3IucHJvdG90eXBlLm1ldGhvZCA9IGZ1bmN0aW9uKCl7Li4ufS5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gPC9zdW1tYXJ5PlxyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cImNvbnN0cnVjdG9yXCI+Q29uc3RydWN0b3IgZnVuY3Rpb24gcmVwcmVzZW50aW5nIHRoZSBjbGFzcy48L3BhcmFtPlxyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cInN0cnVjdHVyZVwiIG9wdGlvbmFsPVwidHJ1ZVwiPkhlbHBzIElERSBjb2RlIGNvbXBsZXRpb24gYnkga25vd2luZyB0aGUgbWVtYmVycyB0aGF0IG9iamVjdHMgY29udGFpbiBhbmQgbm90IGp1c3QgdGhlIGluZGV4ZXMuIEFsc29cclxuICAgICAgICAgICAgICAgICAgICAvLy8ga25vdyB3aGF0IHR5cGUgZWFjaCBtZW1iZXIgaGFzLiBFeGFtcGxlOiB7bmFtZTogU3RyaW5nLCBlbWFpbEFkZHJlc3NlczogW1N0cmluZ10sIHBhc3N3b3JkfTwvcGFyYW0+XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zY2hlbWEubWFwcGVkQ2xhc3MgPSBjb25zdHJ1Y3RvcjtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgaW5zdGFuY2VUZW1wbGF0ZSA9IE9iamVjdC5jcmVhdGUoY29uc3RydWN0b3IucHJvdG90eXBlKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc3RydWN0dXJlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHN0cnVjdHVyZSBhbmQgaW5zdGFuY2VUZW1wbGF0ZSBpcyBmb3IgSURFIGNvZGUgY29tcGV0aW9uIG9ubHkgd2hpbGUgY29uc3RydWN0b3IucHJvdG90eXBlIGlzIGZvciBhY3R1YWwgaW5oZXJpdGFuY2UuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcGx5U3RydWN0dXJlKGluc3RhbmNlVGVtcGxhdGUsIHN0cnVjdHVyZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2NoZW1hLmluc3RhbmNlVGVtcGxhdGUgPSBpbnN0YW5jZVRlbXBsYXRlO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBOb3csIHN1YnNjcmliZSB0byB0aGUgd2hlbihcInJlYWRpbmdcIikgZXZlbnQgdG8gbWFrZSBhbGwgb2JqZWN0cyB0aGF0IGNvbWUgb3V0IGZyb20gdGhpcyB0YWJsZSBpbmhlcml0IGZyb20gZ2l2ZW4gY2xhc3NcclxuICAgICAgICAgICAgICAgICAgICAvLyBubyBtYXR0ZXIgd2hpY2ggbWV0aG9kIHRvIHVzZSBmb3IgcmVhZGluZyAoVGFibGUuZ2V0KCkgb3IgVGFibGUud2hlcmUoLi4uKS4uLiApXHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJlYWRIb29rID0gZnVuY3Rpb24gKG9iaikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIW9iaikgcmV0dXJuIG9iajsgLy8gTm8gdmFsaWQgb2JqZWN0LiAoVmFsdWUgaXMgbnVsbCkuIFJldHVybiBhcyBpcy5cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIGEgbmV3IG9iamVjdCB0aGF0IGRlcml2ZXMgZnJvbSBjb25zdHJ1Y3RvcjpcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHJlcyA9IE9iamVjdC5jcmVhdGUoY29uc3RydWN0b3IucHJvdG90eXBlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xvbmUgbWVtYmVyczpcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgbSBpbiBvYmopIGlmIChvYmouaGFzT3duUHJvcGVydHkobSkpIHJlc1ttXSA9IG9ialttXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlcztcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5zY2hlbWEucmVhZEhvb2spIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5ob29rLnJlYWRpbmcudW5zdWJzY3JpYmUodGhpcy5zY2hlbWEucmVhZEhvb2spO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNjaGVtYS5yZWFkSG9vayA9IHJlYWRIb29rO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaG9vayhcInJlYWRpbmdcIiwgcmVhZEhvb2spO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjb25zdHJ1Y3RvcjtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBkZWZpbmVDbGFzczogZnVuY3Rpb24gKHN0cnVjdHVyZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8c3VtbWFyeT5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gICAgIERlZmluZSBhbGwgbWVtYmVycyBvZiB0aGUgY2xhc3MgdGhhdCByZXByZXNlbnRzIHRoZSB0YWJsZS4gVGhpcyB3aWxsIGhlbHAgY29kZSBjb21wbGV0aW9uIG9mIHdoZW4gb2JqZWN0cyBhcmUgcmVhZCBmcm9tIHRoZSBkYXRhYmFzZVxyXG4gICAgICAgICAgICAgICAgICAgIC8vLyAgICAgYXMgd2VsbCBhcyBtYWtpbmcgaXQgcG9zc2libGUgdG8gZXh0ZW5kIHRoZSBwcm90b3R5cGUgb2YgdGhlIHJldHVybmVkIGNvbnN0cnVjdG9yIGZ1bmN0aW9uLlxyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8L3N1bW1hcnk+XHJcbiAgICAgICAgICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwic3RydWN0dXJlXCI+SGVscHMgSURFIGNvZGUgY29tcGxldGlvbiBieSBrbm93aW5nIHRoZSBtZW1iZXJzIHRoYXQgb2JqZWN0cyBjb250YWluIGFuZCBub3QganVzdCB0aGUgaW5kZXhlcy4gQWxzb1xyXG4gICAgICAgICAgICAgICAgICAgIC8vLyBrbm93IHdoYXQgdHlwZSBlYWNoIG1lbWJlciBoYXMuIEV4YW1wbGU6IHtuYW1lOiBTdHJpbmcsIGVtYWlsQWRkcmVzc2VzOiBbU3RyaW5nXSwgcHJvcGVydGllczoge3Nob2VTaXplOiBOdW1iZXJ9fTwvcGFyYW0+XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMubWFwVG9DbGFzcyhEZXhpZS5kZWZpbmVDbGFzcyhzdHJ1Y3R1cmUpLCBzdHJ1Y3R1cmUpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGFkZDogZmFpbFJlYWRvbmx5LFxyXG4gICAgICAgICAgICAgICAgcHV0OiBmYWlsUmVhZG9ubHksXHJcbiAgICAgICAgICAgICAgICAnZGVsZXRlJzogZmFpbFJlYWRvbmx5LFxyXG4gICAgICAgICAgICAgICAgY2xlYXI6IGZhaWxSZWFkb25seSxcclxuICAgICAgICAgICAgICAgIHVwZGF0ZTogZmFpbFJlYWRvbmx5XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIFdyaXRlYWJsZVRhYmxlIENsYXNzIChleHRlbmRzIFRhYmxlKVxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIGZ1bmN0aW9uIFdyaXRlYWJsZVRhYmxlKG5hbWUsIHRyYW5zYWN0aW9uUHJvbWlzZUZhY3RvcnksIHRhYmxlU2NoZW1hLCBjb2xsQ2xhc3MpIHtcclxuICAgICAgICAgICAgVGFibGUuY2FsbCh0aGlzLCBuYW1lLCB0cmFuc2FjdGlvblByb21pc2VGYWN0b3J5LCB0YWJsZVNjaGVtYSwgY29sbENsYXNzIHx8IFdyaXRlYWJsZUNvbGxlY3Rpb24pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZGVyaXZlKFdyaXRlYWJsZVRhYmxlKS5mcm9tKFRhYmxlKS5leHRlbmQoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgYWRkOiBmdW5jdGlvbiAob2JqLCBrZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHN1bW1hcnk+XHJcbiAgICAgICAgICAgICAgICAgICAgLy8vICAgQWRkIGFuIG9iamVjdCB0byB0aGUgZGF0YWJhc2UuIEluIGNhc2UgYW4gb2JqZWN0IHdpdGggc2FtZSBwcmltYXJ5IGtleSBhbHJlYWR5IGV4aXN0cywgdGhlIG9iamVjdCB3aWxsIG5vdCBiZSBhZGRlZC5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gPC9zdW1tYXJ5PlxyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cIm9ialwiIHR5cGU9XCJPYmplY3RcIj5BIGphdmFzY3JpcHQgb2JqZWN0IHRvIGluc2VydDwvcGFyYW0+XHJcbiAgICAgICAgICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwia2V5XCIgb3B0aW9uYWw9XCJ0cnVlXCI+UHJpbWFyeSBrZXk8L3BhcmFtPlxyXG4gICAgICAgICAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRpbmdIb29rID0gdGhpcy5ob29rLmNyZWF0aW5nLmZpcmU7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2lkYnN0b3JlKFJFQURXUklURSwgZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCwgaWRic3RvcmUsIHRyYW5zKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciB0aGlzQ3R4ID0ge307XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjcmVhdGluZ0hvb2sgIT09IG5vcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGVmZmVjdGl2ZUtleSA9IGtleSB8fCAoaWRic3RvcmUua2V5UGF0aCA/IGdldEJ5S2V5UGF0aChvYmosIGlkYnN0b3JlLmtleVBhdGgpIDogdW5kZWZpbmVkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBrZXlUb1VzZSA9IGNyZWF0aW5nSG9vay5jYWxsKHRoaXNDdHgsIGVmZmVjdGl2ZUtleSwgb2JqLCB0cmFucyk7IC8vIEFsbG93IHN1YnNjcmliZXJzIHRvIHdoZW4oXCJjcmVhdGluZ1wiKSB0byBnZW5lcmF0ZSB0aGUga2V5LlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVmZmVjdGl2ZUtleSA9PT0gdW5kZWZpbmVkICYmIGtleVRvVXNlICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaWRic3RvcmUua2V5UGF0aClcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0QnlLZXlQYXRoKG9iaiwgaWRic3RvcmUua2V5UGF0aCwga2V5VG9Vc2UpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAga2V5ID0ga2V5VG9Vc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy90cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHJlcSA9IGtleSA/IGlkYnN0b3JlLmFkZChvYmosIGtleSkgOiBpZGJzdG9yZS5hZGQob2JqKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcS5vbmVycm9yID0gZXZlbnRSZWplY3RIYW5kbGVyKGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXNDdHgub25lcnJvcikgdGhpc0N0eC5vbmVycm9yKGUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiByZWplY3QoZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LCBbXCJhZGRpbmdcIiwgb2JqLCBcImludG9cIiwgc2VsZi5uYW1lXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGtleVBhdGggPSBpZGJzdG9yZS5rZXlQYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChrZXlQYXRoKSBzZXRCeUtleVBhdGgob2JqLCBrZXlQYXRoLCBldi50YXJnZXQucmVzdWx0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpc0N0eC5vbnN1Y2Nlc3MpIHRoaXNDdHgub25zdWNjZXNzKGV2LnRhcmdldC5yZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUocmVxLnJlc3VsdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvKn0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zLm9uKFwiZXJyb3JcIikuZmlyZShlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zLmFib3J0KCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWplY3QoZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0qL1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICBwdXQ6IGZ1bmN0aW9uIChvYmosIGtleSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8c3VtbWFyeT5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gICBBZGQgYW4gb2JqZWN0IHRvIHRoZSBkYXRhYmFzZSBidXQgaW4gY2FzZSBhbiBvYmplY3Qgd2l0aCBzYW1lIHByaW1hcnkga2V5IGFscmVhZCBleGlzdHMsIHRoZSBleGlzdGluZyBvbmUgd2lsbCBnZXQgdXBkYXRlZC5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gPC9zdW1tYXJ5PlxyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cIm9ialwiIHR5cGU9XCJPYmplY3RcIj5BIGphdmFzY3JpcHQgb2JqZWN0IHRvIGluc2VydCBvciB1cGRhdGU8L3BhcmFtPlxyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cImtleVwiIG9wdGlvbmFsPVwidHJ1ZVwiPlByaW1hcnkga2V5PC9wYXJhbT5cclxuICAgICAgICAgICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0aW5nSG9vayA9IHRoaXMuaG9vay5jcmVhdGluZy5maXJlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGluZ0hvb2sgPSB0aGlzLmhvb2sudXBkYXRpbmcuZmlyZTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoY3JlYXRpbmdIb29rICE9PSBub3AgfHwgdXBkYXRpbmdIb29rICE9PSBub3ApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy9cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUGVvcGxlIGxpc3RlbnMgdG8gd2hlbihcImNyZWF0aW5nXCIpIG9yIHdoZW4oXCJ1cGRhdGluZ1wiKSBldmVudHMhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdlIG11c3Qga25vdyB3aGV0aGVyIHRoZSBwdXQgb3BlcmF0aW9uIHJlc3VsdHMgaW4gYW4gQ1JFQVRFIG9yIFVQREFURS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy9cclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3RyYW5zKFJFQURXUklURSwgZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCwgdHJhbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFNpbmNlIGtleSBpcyBvcHRpb25hbCwgbWFrZSBzdXJlIHdlIGdldCBpdCBmcm9tIG9iaiBpZiBub3QgcHJvdmlkZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBlZmZlY3RpdmVLZXkgPSBrZXkgfHwgKHNlbGYuc2NoZW1hLnByaW1LZXkua2V5UGF0aCAmJiBnZXRCeUtleVBhdGgob2JqLCBzZWxmLnNjaGVtYS5wcmltS2V5LmtleVBhdGgpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlZmZlY3RpdmVLZXkgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE5vIHByaW1hcnkga2V5LiBNdXN0IHVzZSBhZGQoKS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cmFucy50YWJsZXNbc2VsZi5uYW1lXS5hZGQob2JqKS50aGVuKHJlc29sdmUsIHJlamVjdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFByaW1hcnkga2V5IGV4aXN0LiBMb2NrIHRyYW5zYWN0aW9uIGFuZCB0cnkgbW9kaWZ5aW5nIGV4aXN0aW5nLiBJZiBub3RoaW5nIG1vZGlmaWVkLCBjYWxsIGFkZCgpLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zLl9sb2NrKCk7IC8vIE5lZWRlZCBiZWNhdXNlIG9wZXJhdGlvbiBpcyBzcGxpdHRlZCBpbnRvIG1vZGlmeSgpIGFuZCBhZGQoKS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjbG9uZSBvYmogYmVmb3JlIHRoaXMgYXN5bmMgY2FsbC4gSWYgY2FsbGVyIG1vZGlmaWVzIG9iaiB0aGUgbGluZSBhZnRlciBwdXQoKSwgdGhlIElEQiBzcGVjIHJlcXVpcmVzIHRoYXQgaXQgc2hvdWxkIG5vdCBhZmZlY3Qgb3BlcmF0aW9uLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9iaiA9IGRlZXBDbG9uZShvYmopO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zLnRhYmxlc1tzZWxmLm5hbWVdLndoZXJlKFwiOmlkXCIpLmVxdWFscyhlZmZlY3RpdmVLZXkpLm1vZGlmeShmdW5jdGlvbiAodmFsdWUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmVwbGFjZSBleHRpc3RpbmcgdmFsdWUgd2l0aCBvdXIgb2JqZWN0XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIENSVUQgZXZlbnQgZmlyaW5nIGhhbmRsZWQgaW4gV3JpdGVhYmxlQ29sbGVjdGlvbi5tb2RpZnkoKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnZhbHVlID0gb2JqO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pLnRoZW4oZnVuY3Rpb24gKGNvdW50KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb3VudCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gT2JqZWN0J3Mga2V5IHdhcyBub3QgZm91bmQuIEFkZCB0aGUgb2JqZWN0IGluc3RlYWQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBDUlVEIGV2ZW50IGZpcmluZyB3aWxsIGJlIGRvbmUgaW4gYWRkKClcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cmFucy50YWJsZXNbc2VsZi5uYW1lXS5hZGQob2JqLCBrZXkpOyAvLyBSZXNvbHZpbmcgd2l0aCBhbm90aGVyIFByb21pc2UuIFJldHVybmVkIFByb21pc2Ugd2lsbCB0aGVuIHJlc29sdmUgd2l0aCB0aGUgbmV3IGtleS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBlZmZlY3RpdmVLZXk7IC8vIFJlc29sdmUgd2l0aCB0aGUgcHJvdmlkZWQga2V5LlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSkuZmluYWxseShmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zLl91bmxvY2soKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KS50aGVuKHJlc29sdmUsIHJlamVjdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUgc3RhbmRhcmQgSURCIHB1dCgpIG1ldGhvZC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2lkYnN0b3JlKFJFQURXUklURSwgZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCwgaWRic3RvcmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciByZXEgPSBrZXkgPyBpZGJzdG9yZS5wdXQob2JqLCBrZXkpIDogaWRic3RvcmUucHV0KG9iaik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXEub25lcnJvciA9IGV2ZW50UmVqZWN0SGFuZGxlcihyZWplY3QsIFtcInB1dHRpbmdcIiwgb2JqLCBcImludG9cIiwgc2VsZi5uYW1lXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGtleVBhdGggPSBpZGJzdG9yZS5rZXlQYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChrZXlQYXRoKSBzZXRCeUtleVBhdGgob2JqLCBrZXlQYXRoLCBldi50YXJnZXQucmVzdWx0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHJlcS5yZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICAnZGVsZXRlJzogZnVuY3Rpb24gKGtleSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cImtleVwiPlByaW1hcnkga2V5IG9mIHRoZSBvYmplY3QgdG8gZGVsZXRlPC9wYXJhbT5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5ob29rLmRlbGV0aW5nLnN1YnNjcmliZXJzLmxlbmd0aCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBQZW9wbGUgbGlzdGVucyB0byB3aGVuKFwiZGVsZXRpbmdcIikgZXZlbnQuIE11c3QgaW1wbGVtZW50IGRlbGV0ZSB1c2luZyBXcml0ZWFibGVDb2xsZWN0aW9uLmRlbGV0ZSgpIHRoYXQgd2lsbFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBjYWxsIHRoZSBDUlVEIGV2ZW50LiBPbmx5IFdyaXRlYWJsZUNvbGxlY3Rpb24uZGVsZXRlKCkgd2lsbCBrbm93IHdoZXRoZXIgYW4gb2JqZWN0IHdhcyBhY3R1YWxseSBkZWxldGVkLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy53aGVyZShcIjppZFwiKS5lcXVhbHMoa2V5KS5kZWxldGUoKTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBObyBvbmUgbGlzdGVucy4gVXNlIHN0YW5kYXJkIElEQiBkZWxldGUoKSBtZXRob2QuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLl9pZGJzdG9yZShSRUFEV1JJVEUsIGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QsIGlkYnN0b3JlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVxID0gaWRic3RvcmUuZGVsZXRlKGtleSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXEub25lcnJvciA9IGV2ZW50UmVqZWN0SGFuZGxlcihyZWplY3QsIFtcImRlbGV0aW5nXCIsIGtleSwgXCJmcm9tXCIsIGlkYnN0b3JlLm5hbWVdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHJlcS5yZXN1bHQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICBjbGVhcjogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmhvb2suZGVsZXRpbmcuc3Vic2NyaWJlcnMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFBlb3BsZSBsaXN0ZW5zIHRvIHdoZW4oXCJkZWxldGluZ1wiKSBldmVudC4gTXVzdCBpbXBsZW1lbnQgZGVsZXRlIHVzaW5nIFdyaXRlYWJsZUNvbGxlY3Rpb24uZGVsZXRlKCkgdGhhdCB3aWxsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNhbGwgdGhlIENSVUQgZXZlbnQuIE9ubHkgV3JpdGVhYmxlQ29sbGVjdGlvbi5kZWxldGUoKSB3aWxsIGtub3dzIHdoaWNoIG9iamVjdHMgdGhhdCBhcmUgYWN0dWFsbHkgZGVsZXRlZC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMudG9Db2xsZWN0aW9uKCkuZGVsZXRlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2lkYnN0b3JlKFJFQURXUklURSwgZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCwgaWRic3RvcmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciByZXEgPSBpZGJzdG9yZS5jbGVhcigpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxLm9uZXJyb3IgPSBldmVudFJlamVjdEhhbmRsZXIocmVqZWN0LCBbXCJjbGVhcmluZ1wiLCBpZGJzdG9yZS5uYW1lXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXEub25zdWNjZXNzID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXEucmVzdWx0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0sXHJcblxyXG4gICAgICAgICAgICAgICAgdXBkYXRlOiBmdW5jdGlvbiAoa2V5T3JPYmplY3QsIG1vZGlmaWNhdGlvbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIG1vZGlmaWNhdGlvbnMgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkobW9kaWZpY2F0aW9ucykpIHRocm93IG5ldyBFcnJvcihcImRiLnVwZGF0ZShrZXlPck9iamVjdCwgbW9kaWZpY2F0aW9ucykuIG1vZGlmaWNhdGlvbnMgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2Yga2V5T3JPYmplY3QgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KGtleU9yT2JqZWN0KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBvYmplY3QgdG8gbW9kaWZ5LiBBbHNvIG1vZGlmeSBnaXZlbiBvYmplY3Qgd2l0aCB0aGUgbW9kaWZpY2F0aW9uczpcclxuICAgICAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXMobW9kaWZpY2F0aW9ucykuZm9yRWFjaChmdW5jdGlvbiAoa2V5UGF0aCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0QnlLZXlQYXRoKGtleU9yT2JqZWN0LCBrZXlQYXRoLCBtb2RpZmljYXRpb25zW2tleVBhdGhdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBrZXkgPSBnZXRCeUtleVBhdGgoa2V5T3JPYmplY3QsIHRoaXMuc2NoZW1hLnByaW1LZXkua2V5UGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IHVuZGVmaW5lZCkgUHJvbWlzZS5yZWplY3QobmV3IEVycm9yKFwiT2JqZWN0IGRvZXMgbm90IGNvbnRhaW4gaXRzIHByaW1hcnkga2V5XCIpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMud2hlcmUoXCI6aWRcIikuZXF1YWxzKGtleSkubW9kaWZ5KG1vZGlmaWNhdGlvbnMpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGtleSB0byBtb2RpZnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMud2hlcmUoXCI6aWRcIikuZXF1YWxzKGtleU9yT2JqZWN0KS5tb2RpZnkobW9kaWZpY2F0aW9ucyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy8gVHJhbnNhY3Rpb24gQ2xhc3NcclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICBmdW5jdGlvbiBUcmFuc2FjdGlvbihtb2RlLCBzdG9yZU5hbWVzLCBkYnNjaGVtYSwgcGFyZW50KSB7XHJcbiAgICAgICAgICAgIC8vLyA8c3VtbWFyeT5cclxuICAgICAgICAgICAgLy8vICAgIFRyYW5zYWN0aW9uIGNsYXNzLiBSZXByZXNlbnRzIGEgZGF0YWJhc2UgdHJhbnNhY3Rpb24uIEFsbCBvcGVyYXRpb25zIG9uIGRiIGdvZXMgdGhyb3VnaCBhIFRyYW5zYWN0aW9uLlxyXG4gICAgICAgICAgICAvLy8gPC9zdW1tYXJ5PlxyXG4gICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJtb2RlXCIgdHlwZT1cIlN0cmluZ1wiPkFueSBvZiBcInJlYWR3cml0ZVwiIG9yIFwicmVhZG9ubHlcIjwvcGFyYW0+XHJcbiAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cInN0b3JlTmFtZXNcIiB0eXBlPVwiQXJyYXlcIj5BcnJheSBvZiB0YWJsZSBuYW1lcyB0byBvcGVyYXRlIG9uPC9wYXJhbT5cclxuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICB0aGlzLmRiID0gZGI7XHJcbiAgICAgICAgICAgIHRoaXMubW9kZSA9IG1vZGU7XHJcbiAgICAgICAgICAgIHRoaXMuc3RvcmVOYW1lcyA9IHN0b3JlTmFtZXM7XHJcbiAgICAgICAgICAgIHRoaXMuaWRidHJhbnMgPSBudWxsO1xyXG4gICAgICAgICAgICB0aGlzLm9uID0gZXZlbnRzKHRoaXMsIFtcImNvbXBsZXRlXCIsIFwiZXJyb3JcIl0sIFwiYWJvcnRcIik7XHJcbiAgICAgICAgICAgIHRoaXMuX3JlY3Vsb2NrID0gMDtcclxuICAgICAgICAgICAgdGhpcy5fYmxvY2tlZEZ1bmNzID0gW107XHJcbiAgICAgICAgICAgIHRoaXMuX3BzZCA9IG51bGw7XHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhpcy5fZGJzY2hlbWEgPSBkYnNjaGVtYTtcclxuICAgICAgICAgICAgaWYgKHBhcmVudCkgdGhpcy5wYXJlbnQgPSBwYXJlbnQ7XHJcbiAgICAgICAgICAgIHRoaXMuX3RwZiA9IHRyYW5zYWN0aW9uUHJvbWlzZUZhY3Rvcnk7XHJcbiAgICAgICAgICAgIHRoaXMudGFibGVzID0gT2JqZWN0LmNyZWF0ZShub3RJblRyYW5zRmFsbGJhY2tUYWJsZXMpOyAvLyAuLi5zbyB0aGF0IGFsbCBub24taW5jbHVkZWQgdGFibGVzIGV4aXN0cyBhcyBpbnN0YW5jZXMgKHBvc3NpYmxlIHRvIGNhbGwgdGFibGUubmFtZSBmb3IgZXhhbXBsZSkgYnV0IHdpbGwgZmFpbCBhcyBzb29uIGFzIHRyeWluZyB0byBleGVjdXRlIGEgcXVlcnkgb24gaXQuXHJcblxyXG4gICAgICAgICAgICBmdW5jdGlvbiB0cmFuc2FjdGlvblByb21pc2VGYWN0b3J5KG1vZGUsIHN0b3JlTmFtZXMsIGZuLCB3cml0ZUxvY2tlZCkge1xyXG4gICAgICAgICAgICAgICAgLy8gQ3JlYXRlcyBhIFByb21pc2UgaW5zdGFuY2UgYW5kIGNhbGxzIGZuIChyZXNvbHZlLCByZWplY3QsIHRyYW5zKSB3aGVyZSB0cmFucyBpcyB0aGUgaW5zdGFuY2Ugb2YgdGhpcyB0cmFuc2FjdGlvbiBvYmplY3QuXHJcbiAgICAgICAgICAgICAgICAvLyBTdXBwb3J0IGZvciB3cml0ZS1sb2NraW5nIHRoZSB0cmFuc2FjdGlvbiBkdXJpbmcgdGhlIHByb21pc2UgbGlmZSB0aW1lIGZyb20gY3JlYXRpb24gdG8gc3VjY2Vzcy9mYWlsdXJlLlxyXG4gICAgICAgICAgICAgICAgLy8gVGhpcyBpcyBhY3R1YWxseSBub3QgbmVlZGVkIHdoZW4ganVzdCB1c2luZyBzaW5nbGUgb3BlcmF0aW9ucyBvbiBJREIsIHNpbmNlIElEQiBpbXBsZW1lbnRzIHRoaXMgaW50ZXJuYWxseS5cclxuICAgICAgICAgICAgICAgIC8vIEhvd2V2ZXIsIHdoZW4gaW1wbGVtZW50aW5nIGEgd3JpdGUgb3BlcmF0aW9uIGFzIGEgc2VyaWVzIG9mIG9wZXJhdGlvbnMgb24gdG9wIG9mIElEQihjb2xsZWN0aW9uLmRlbGV0ZSgpIGFuZCBjb2xsZWN0aW9uLm1vZGlmeSgpIGZvciBleGFtcGxlKSxcclxuICAgICAgICAgICAgICAgIC8vIGxvY2sgaXMgaW5kZWVkIG5lZWRlZCBpZiBEZXhpZSBBUElzaG91bGQgYmVoYXZlIGluIGEgY29uc2lzdGVudCBtYW5uZXIgZm9yIHRoZSBBUEkgdXNlci5cclxuICAgICAgICAgICAgICAgIC8vIEFub3RoZXIgZXhhbXBsZSBvZiB0aGlzIGlzIGlmIHdlIHdhbnQgdG8gc3VwcG9ydCBjcmVhdGUvdXBkYXRlL2RlbGV0ZSBldmVudHMsXHJcbiAgICAgICAgICAgICAgICAvLyB3ZSBuZWVkIHRvIGltcGxlbWVudCBwdXQoKSB1c2luZyBhIHNlcmllcyBvZiBvdGhlciBJREIgb3BlcmF0aW9ucyBidXQgc3RpbGwgbmVlZCB0byBsb2NrIHRoZSB0cmFuc2FjdGlvbiBhbGwgdGhlIHdheS5cclxuICAgICAgICAgICAgICAgIHJldHVybiBzZWxmLl9wcm9taXNlKG1vZGUsIGZuLCB3cml0ZUxvY2tlZCk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSBzdG9yZU5hbWVzLmxlbmd0aCAtIDE7IGkgIT09IC0xOyAtLWkpIHtcclxuICAgICAgICAgICAgICAgIHZhciBuYW1lID0gc3RvcmVOYW1lc1tpXTtcclxuICAgICAgICAgICAgICAgIHZhciB0YWJsZSA9IGRiLl90YWJsZUZhY3RvcnkobW9kZSwgZGJzY2hlbWFbbmFtZV0sIHRyYW5zYWN0aW9uUHJvbWlzZUZhY3RvcnkpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy50YWJsZXNbbmFtZV0gPSB0YWJsZTtcclxuICAgICAgICAgICAgICAgIGlmICghdGhpc1tuYW1lXSkgdGhpc1tuYW1lXSA9IHRhYmxlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBleHRlbmQoVHJhbnNhY3Rpb24ucHJvdG90eXBlLCB7XHJcbiAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgIC8vIFRyYW5zYWN0aW9uIFByb3RlY3RlZCBNZXRob2RzIChub3QgcmVxdWlyZWQgYnkgQVBJIHVzZXJzLCBidXQgbmVlZGVkIGludGVybmFsbHkgYW5kIGV2ZW50dWFsbHkgYnkgZGV4aWUgZXh0ZW5zaW9ucylcclxuICAgICAgICAgICAgLy9cclxuXHJcbiAgICAgICAgICAgIF9sb2NrOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBUZW1wb3Jhcnkgc2V0IGFsbCByZXF1ZXN0cyBpbnRvIGEgcGVuZGluZyBxdWV1ZSBpZiB0aGV5IGFyZSBjYWxsZWQgYmVmb3JlIGRhdGFiYXNlIGlzIHJlYWR5LlxyXG4gICAgICAgICAgICAgICAgKyt0aGlzLl9yZWN1bG9jazsgLy8gUmVjdXJzaXZlIHJlYWQvd3JpdGUgbG9jayBwYXR0ZXJuIHVzaW5nIFBTRCAoUHJvbWlzZSBTcGVjaWZpYyBEYXRhKSBpbnN0ZWFkIG9mIFRMUyAoVGhyZWFkIExvY2FsIFN0b3JhZ2UpXHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fcmVjdWxvY2sgPT09IDEgJiYgUHJvbWlzZS5QU0QpIFByb21pc2UuUFNELmxvY2tPd25lckZvciA9IHRoaXM7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgX3VubG9jazogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKC0tdGhpcy5fcmVjdWxvY2sgPT09IDApIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoUHJvbWlzZS5QU0QpIFByb21pc2UuUFNELmxvY2tPd25lckZvciA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgd2hpbGUgKHRoaXMuX2Jsb2NrZWRGdW5jcy5sZW5ndGggPiAwICYmICF0aGlzLl9sb2NrZWQoKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgZm4gPSB0aGlzLl9ibG9ja2VkRnVuY3Muc2hpZnQoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHsgZm4oKTsgfSBjYXRjaCAoZSkgeyB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF9sb2NrZWQ6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgIC8vIENoZWNrcyBpZiBhbnkgd3JpdGUtbG9jayBpcyBhcHBsaWVkIG9uIHRoaXMgdHJhbnNhY3Rpb24uXHJcbiAgICAgICAgICAgICAgICAvLyBUbyBzaW1wbGlmeSB0aGUgRGV4aWUgQVBJIGZvciBleHRlbnNpb24gaW1wbGVtZW50YXRpb25zLCB3ZSBzdXBwb3J0IHJlY3Vyc2l2ZSBsb2Nrcy5cclxuICAgICAgICAgICAgICAgIC8vIFRoaXMgaXMgYWNjb21wbGlzaGVkIGJ5IHVzaW5nIFwiUHJvbWlzZSBTcGVjaWZpYyBEYXRhXCIgKFBTRCkuXHJcbiAgICAgICAgICAgICAgICAvLyBQU0QgZGF0YSBpcyBib3VuZCB0byBhIFByb21pc2UgYW5kIGFueSBjaGlsZCBQcm9taXNlIGVtaXR0ZWQgdGhyb3VnaCB0aGVuKCkgb3IgcmVzb2x2ZSggbmV3IFByb21pc2UoKSApLlxyXG4gICAgICAgICAgICAgICAgLy8gUHJvbWlzZS5QU0QgaXMgbG9jYWwgdG8gY29kZSBleGVjdXRpbmcgb24gdG9wIG9mIHRoZSBjYWxsIHN0YWNrcyBvZiBhbnkgb2YgYW55IGNvZGUgZXhlY3V0ZWQgYnkgUHJvbWlzZSgpOlxyXG4gICAgICAgICAgICAgICAgLy8gICAgICAgICAqIGNhbGxiYWNrIGdpdmVuIHRvIHRoZSBQcm9taXNlKCkgY29uc3RydWN0b3IgIChmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KXsuLi59KVxyXG4gICAgICAgICAgICAgICAgLy8gICAgICAgICAqIGNhbGxiYWNrcyBnaXZlbiB0byB0aGVuKCkvY2F0Y2goKS9maW5hbGx5KCkgbWV0aG9kcyAoZnVuY3Rpb24gKHZhbHVlKXsuLi59KVxyXG4gICAgICAgICAgICAgICAgLy8gSWYgY3JlYXRpbmcgYSBuZXcgaW5kZXBlbmRhbnQgUHJvbWlzZSBpbnN0YW5jZSBmcm9tIHdpdGhpbiBhIFByb21pc2UgY2FsbCBzdGFjaywgdGhlIG5ldyBQcm9taXNlIHdpbGwgZGVyaXZlIHRoZSBQU0QgZnJvbSB0aGUgY2FsbCBzdGFjayBvZiB0aGUgcGFyZW50IFByb21pc2UuXHJcbiAgICAgICAgICAgICAgICAvLyBEZXJpdmF0aW9uIGlzIGRvbmUgc28gdGhhdCB0aGUgaW5uZXIgUFNEIF9fcHJvdG9fXyBwb2ludHMgdG8gdGhlIG91dGVyIFBTRC5cclxuICAgICAgICAgICAgICAgIC8vIFByb21pc2UuUFNELmxvY2tPd25lckZvciB3aWxsIHBvaW50IHRvIGN1cnJlbnQgdHJhbnNhY3Rpb24gb2JqZWN0IGlmIHRoZSBjdXJyZW50bHkgZXhlY3V0aW5nIFBTRCBzY29wZSBvd25zIHRoZSBsb2NrLlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JlY3Vsb2NrICYmICghUHJvbWlzZS5QU0QgfHwgUHJvbWlzZS5QU0QubG9ja093bmVyRm9yICE9PSB0aGlzKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgX25vcDogZnVuY3Rpb24gKGNiKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBBbiBhc3luY3JvbmljIG5vLW9wZXJhdGlvbiB0aGF0IG1heSBjYWxsIGdpdmVuIGNhbGxiYWNrIHdoZW4gZG9uZSBkb2luZyBub3RoaW5nLiBBbiBhbHRlcm5hdGl2ZSB0byBhc2FwKCkgaWYgd2UgbXVzdCBub3QgbG9zZSB0aGUgdHJhbnNhY3Rpb24uXHJcbiAgICAgICAgICAgICAgICB0aGlzLnRhYmxlc1t0aGlzLnN0b3JlTmFtZXNbMF1dLmdldCgwKS50aGVuKGNiKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgX3Byb21pc2U6IGZ1bmN0aW9uIChtb2RlLCBmbiwgYldyaXRlTG9jaykge1xyXG4gICAgICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UubmV3UFNEKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBwO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJlYWQgbG9jayBhbHdheXNcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXNlbGYuX2xvY2tlZCgpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHAgPSBzZWxmLmFjdGl2ZSA/IG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghc2VsZi5pZGJ0cmFucyAmJiBtb2RlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFpZGJkYikgdGhyb3cgZGJPcGVuRXJyb3IgPyBuZXcgRXJyb3IoXCJEYXRhYmFzZSBub3Qgb3Blbi4gRm9sbG93aW5nIGVycm9yIGluIHBvcHVsYXRlLCByZWFkeSBvciB1cGdyYWRlIGZ1bmN0aW9uIG1hZGUgRGV4aWUub3BlbigpIGZhaWw6IFwiICsgZGJPcGVuRXJyb3IpIDogbmV3IEVycm9yKFwiRGF0YWJhc2Ugbm90IG9wZW5cIik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGlkYnRyYW5zID0gc2VsZi5pZGJ0cmFucyA9IGlkYmRiLnRyYW5zYWN0aW9uKHNhZmFyaU11bHRpU3RvcmVGaXgoc2VsZi5zdG9yZU5hbWVzKSwgc2VsZi5tb2RlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZGJ0cmFucy5vbmVycm9yID0gZnVuY3Rpb24gKGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5vbihcImVycm9yXCIpLmZpcmUoZSAmJiBlLnRhcmdldC5lcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTsgLy8gUHJvaGliaXQgZGVmYXVsdCBidWJibGluZyB0byB3aW5kb3cuZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5hYm9ydCgpOyAvLyBNYWtlIHN1cmUgdHJhbnNhY3Rpb24gaXMgYWJvcnRlZCBzaW5jZSB3ZSBwcmV2ZW50RGVmYXVsdC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9OyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZGJ0cmFucy5vbmFib3J0ID0gZnVuY3Rpb24gKGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5hY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5vbihcImFib3J0XCIpLmZpcmUoZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfTsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWRidHJhbnMub25jb21wbGV0ZSA9IGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYuYWN0aXZlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYub24oXCJjb21wbGV0ZVwiKS5maXJlKGUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGJXcml0ZUxvY2spIHNlbGYuX2xvY2soKTsgLy8gV3JpdGUgbG9jayBpZiB3cml0ZSBvcGVyYXRpb24gaXMgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZuKHJlc29sdmUsIHJlamVjdCwgc2VsZik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGlyZWN0IGV4Y2VwdGlvbiBoYXBwZW5lZCB3aGVuIGRvaW4gb3BlcmF0aW9uLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdlIG11c3QgaW1tZWRpYXRlbHkgZmlyZSB0aGUgZXJyb3IgYW5kIGFib3J0IHRoZSB0cmFuc2FjdGlvbi5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBXaGVuIHRoaXMgaGFwcGVucyB3ZSBhcmUgc3RpbGwgY29uc3RydWN0aW5nIHRoZSBQcm9taXNlIHNvIHdlIGRvbid0IHlldCBrbm93XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2hldGhlciB0aGUgY2FsbGVyIGlzIGFib3V0IHRvIGNhdGNoKCkgdGhlIGVycm9yIG9yIG5vdC4gSGF2ZSB0byBtYWtlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJhbnNhY3Rpb24gZmFpbC4gQ2F0Y2hpbmcgc3VjaCBhbiBlcnJvciB3b250IHN0b3AgdHJhbnNhY3Rpb24gZnJvbSBmYWlsaW5nLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoaXMgaXMgYSBsaW1pdGF0aW9uIHdlIGhhdmUgdG8gbGl2ZSB3aXRoLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIERleGllLmlnbm9yZVRyYW5zYWN0aW9uKGZ1bmN0aW9uICgpIHsgc2VsZi5vbignZXJyb3InKS5maXJlKGUpOyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxmLmFib3J0KCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KSA6IFByb21pc2UucmVqZWN0KHN0YWNrKG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uIGlzIGluYWN0aXZlLiBPcmlnaW5hbCBTY29wZSBGdW5jdGlvbiBTb3VyY2U6IFwiICsgc2VsZi5zY29wZUZ1bmMudG9TdHJpbmcoKSkpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNlbGYuYWN0aXZlICYmIGJXcml0ZUxvY2spIHAuZmluYWxseShmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxmLl91bmxvY2soKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJhbnNhY3Rpb24gaXMgd3JpdGUtbG9ja2VkLiBXYWl0IGZvciBtdXRleC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYuX2Jsb2NrZWRGdW5jcy5wdXNoKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxmLl9wcm9taXNlKG1vZGUsIGZuLCBiV3JpdGVMb2NrKS50aGVuKHJlc29sdmUsIHJlamVjdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHAub251bmNhdGNoZWQgPSBmdW5jdGlvbiAoZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBCdWJibGUgdG8gdHJhbnNhY3Rpb24uIEV2ZW4gdGhvdWdoIElEQiBkb2VzIHRoaXMgaW50ZXJuYWxseSwgaXQgd291bGQganVzdCBkbyBpdCBmb3IgZXJyb3IgZXZlbnRzIGFuZCBub3QgZm9yIGNhdWdodCBleGNlcHRpb25zLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBEZXhpZS5pZ25vcmVUcmFuc2FjdGlvbihmdW5jdGlvbiAoKSB7IHNlbGYub24oXCJlcnJvclwiKS5maXJlKGUpOyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5hYm9ydCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHA7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgIC8vIFRyYW5zYWN0aW9uIFB1YmxpYyBNZXRob2RzXHJcbiAgICAgICAgICAgIC8vXHJcblxyXG4gICAgICAgICAgICBjb21wbGV0ZTogZnVuY3Rpb24gKGNiKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5vbihcImNvbXBsZXRlXCIsIGNiKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgZXJyb3I6IGZ1bmN0aW9uIChjYikge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMub24oXCJlcnJvclwiLCBjYik7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIGFib3J0OiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5pZGJ0cmFucyAmJiB0aGlzLmFjdGl2ZSkgdHJ5IHsgLy8gVE9ETzogaWYgIXRoaXMuaWRidHJhbnMsIGVucXVldWUgYW4gYWJvcnQoKSBvcGVyYXRpb24uXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5hY3RpdmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmlkYnRyYW5zLmFib3J0KCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5vbi5lcnJvci5maXJlKG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uIEFib3J0ZWRcIikpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkgeyB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHRhYmxlOiBmdW5jdGlvbiAobmFtZSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLnRhYmxlcy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJUYWJsZSBcIiArIG5hbWUgKyBcIiBub3QgaW4gdHJhbnNhY3Rpb25cIik7IHJldHVybiB7IEFOX1VOS05PV05fVEFCTEVfTkFNRV9XQVNfU1BFQ0lGSUVEOiAxIH07IH1cclxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnRhYmxlc1tuYW1lXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyBXaGVyZUNsYXVzZVxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIGZ1bmN0aW9uIFdoZXJlQ2xhdXNlKHRhYmxlLCBpbmRleCwgb3JDb2xsZWN0aW9uKSB7XHJcbiAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cInRhYmxlXCIgdHlwZT1cIlRhYmxlXCI+PC9wYXJhbT5cclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwiaW5kZXhcIiB0eXBlPVwiU3RyaW5nXCIgb3B0aW9uYWw9XCJ0cnVlXCI+PC9wYXJhbT5cclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwib3JDb2xsZWN0aW9uXCIgdHlwZT1cIkNvbGxlY3Rpb25cIiBvcHRpb25hbD1cInRydWVcIj48L3BhcmFtPlxyXG4gICAgICAgICAgICB0aGlzLl9jdHggPSB7XHJcbiAgICAgICAgICAgICAgICB0YWJsZTogdGFibGUsXHJcbiAgICAgICAgICAgICAgICBpbmRleDogaW5kZXggPT09IFwiOmlkXCIgPyBudWxsIDogaW5kZXgsXHJcbiAgICAgICAgICAgICAgICBjb2xsQ2xhc3M6IHRhYmxlLl9jb2xsQ2xhc3MsXHJcbiAgICAgICAgICAgICAgICBvcjogb3JDb2xsZWN0aW9uXHJcbiAgICAgICAgICAgIH07IFxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZXh0ZW5kKFdoZXJlQ2xhdXNlLnByb3RvdHlwZSwgZnVuY3Rpb24gKCkge1xyXG5cclxuICAgICAgICAgICAgLy8gV2hlcmVDbGF1c2UgcHJpdmF0ZSBtZXRob2RzXHJcblxyXG4gICAgICAgICAgICBmdW5jdGlvbiBmYWlsKGNvbGxlY3Rpb24sIGVycikge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHsgdGhyb3cgZXJyOyB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sbGVjdGlvbi5fY3R4LmVycm9yID0gZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHJldHVybiBjb2xsZWN0aW9uO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBmdW5jdGlvbiBnZXRTZXRBcmdzKGFyZ3MpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmdzLmxlbmd0aCA9PT0gMSAmJiBBcnJheS5pc0FycmF5KGFyZ3NbMF0pID8gYXJnc1swXSA6IGFyZ3MpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBmdW5jdGlvbiB1cHBlckZhY3RvcnkoZGlyKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZGlyID09PSBcIm5leHRcIiA/IGZ1bmN0aW9uIChzKSB7IHJldHVybiBzLnRvVXBwZXJDYXNlKCk7IH0gOiBmdW5jdGlvbiAocykgeyByZXR1cm4gcy50b0xvd2VyQ2FzZSgpOyB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGZ1bmN0aW9uIGxvd2VyRmFjdG9yeShkaXIpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBkaXIgPT09IFwibmV4dFwiID8gZnVuY3Rpb24gKHMpIHsgcmV0dXJuIHMudG9Mb3dlckNhc2UoKTsgfSA6IGZ1bmN0aW9uIChzKSB7IHJldHVybiBzLnRvVXBwZXJDYXNlKCk7IH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZnVuY3Rpb24gbmV4dENhc2luZyhrZXksIGxvd2VyS2V5LCB1cHBlck5lZWRsZSwgbG93ZXJOZWVkbGUsIGNtcCwgZGlyKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgbGVuZ3RoID0gTWF0aC5taW4oa2V5Lmxlbmd0aCwgbG93ZXJOZWVkbGUubGVuZ3RoKTtcclxuICAgICAgICAgICAgICAgIHZhciBsbHAgPSAtMTtcclxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgbHdyS2V5Q2hhciA9IGxvd2VyS2V5W2ldO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChsd3JLZXlDaGFyICE9PSBsb3dlck5lZWRsZVtpXSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY21wKGtleVtpXSwgdXBwZXJOZWVkbGVbaV0pIDwgMCkgcmV0dXJuIGtleS5zdWJzdHIoMCwgaSkgKyB1cHBlck5lZWRsZVtpXSArIHVwcGVyTmVlZGxlLnN1YnN0cihpICsgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjbXAoa2V5W2ldLCBsb3dlck5lZWRsZVtpXSkgPCAwKSByZXR1cm4ga2V5LnN1YnN0cigwLCBpKSArIGxvd2VyTmVlZGxlW2ldICsgdXBwZXJOZWVkbGUuc3Vic3RyKGkgKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGxscCA+PSAwKSByZXR1cm4ga2V5LnN1YnN0cigwLCBsbHApICsgbG93ZXJLZXlbbGxwXSArIHVwcGVyTmVlZGxlLnN1YnN0cihsbHAgKyAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChjbXAoa2V5W2ldLCBsd3JLZXlDaGFyKSA8IDApIGxscCA9IGk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAobGVuZ3RoIDwgbG93ZXJOZWVkbGUubGVuZ3RoICYmIGRpciA9PT0gXCJuZXh0XCIpIHJldHVybiBrZXkgKyB1cHBlck5lZWRsZS5zdWJzdHIoa2V5Lmxlbmd0aCk7XHJcbiAgICAgICAgICAgICAgICBpZiAobGVuZ3RoIDwga2V5Lmxlbmd0aCAmJiBkaXIgPT09IFwicHJldlwiKSByZXR1cm4ga2V5LnN1YnN0cigwLCB1cHBlck5lZWRsZS5sZW5ndGgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIChsbHAgPCAwID8gbnVsbCA6IGtleS5zdWJzdHIoMCwgbGxwKSArIGxvd2VyTmVlZGxlW2xscF0gKyB1cHBlck5lZWRsZS5zdWJzdHIobGxwICsgMSkpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBmdW5jdGlvbiBhZGRJZ25vcmVDYXNlQWxnb3JpdGhtKGMsIG1hdGNoLCBuZWVkbGUpIHtcclxuICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cIm5lZWRsZVwiIHR5cGU9XCJTdHJpbmdcIj48L3BhcmFtPlxyXG4gICAgICAgICAgICAgICAgdmFyIHVwcGVyLCBsb3dlciwgY29tcGFyZSwgdXBwZXJOZWVkbGUsIGxvd2VyTmVlZGxlLCBkaXJlY3Rpb247XHJcbiAgICAgICAgICAgICAgICBmdW5jdGlvbiBpbml0RGlyZWN0aW9uKGRpcikge1xyXG4gICAgICAgICAgICAgICAgICAgIHVwcGVyID0gdXBwZXJGYWN0b3J5KGRpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgbG93ZXIgPSBsb3dlckZhY3RvcnkoZGlyKTtcclxuICAgICAgICAgICAgICAgICAgICBjb21wYXJlID0gKGRpciA9PT0gXCJuZXh0XCIgPyBhc2NlbmRpbmcgOiBkZXNjZW5kaW5nKTtcclxuICAgICAgICAgICAgICAgICAgICB1cHBlck5lZWRsZSA9IHVwcGVyKG5lZWRsZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgbG93ZXJOZWVkbGUgPSBsb3dlcihuZWVkbGUpO1xyXG4gICAgICAgICAgICAgICAgICAgIGRpcmVjdGlvbiA9IGRpcjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGluaXREaXJlY3Rpb24oXCJuZXh0XCIpO1xyXG4gICAgICAgICAgICAgICAgYy5fb25kaXJlY3Rpb25jaGFuZ2UgPSBmdW5jdGlvbiAoZGlyZWN0aW9uKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVGhpcyBldmVudCBvbmx5cyBvY2N1ciBiZWZvcmUgZmlsdGVyIGlzIGNhbGxlZCB0aGUgZmlyc3QgdGltZS5cclxuICAgICAgICAgICAgICAgICAgICBpbml0RGlyZWN0aW9uKGRpcmVjdGlvbik7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgYy5fYWRkQWxnb3JpdGhtKGZ1bmN0aW9uIChjdXJzb3IsIGFkdmFuY2UsIHJlc29sdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJjdXJzb3JcIiB0eXBlPVwiSURCQ3Vyc29yXCI+PC9wYXJhbT5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJhZHZhbmNlXCIgdHlwZT1cIkZ1bmN0aW9uXCI+PC9wYXJhbT5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJyZXNvbHZlXCIgdHlwZT1cIkZ1bmN0aW9uXCI+PC9wYXJhbT5cclxuICAgICAgICAgICAgICAgICAgICB2YXIga2V5ID0gY3Vyc29yLmtleTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGtleSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgbG93ZXJLZXkgPSBsb3dlcihrZXkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChtYXRjaChsb3dlcktleSwgbG93ZXJOZWVkbGUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFkdmFuY2UoZnVuY3Rpb24gKCkgeyBjdXJzb3IuY29udGludWUoKTsgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBuZXh0TmVlZGxlID0gbmV4dENhc2luZyhrZXksIGxvd2VyS2V5LCB1cHBlck5lZWRsZSwgbG93ZXJOZWVkbGUsIGNvbXBhcmUsIGRpcmVjdGlvbik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChuZXh0TmVlZGxlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhZHZhbmNlKGZ1bmN0aW9uICgpIHsgY3Vyc29yLmNvbnRpbnVlKG5leHROZWVkbGUpOyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkdmFuY2UocmVzb2x2ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvL1xyXG4gICAgICAgICAgICAvLyBXaGVyZUNsYXVzZSBwdWJsaWMgbWV0aG9kc1xyXG4gICAgICAgICAgICAvL1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgYmV0d2VlbjogZnVuY3Rpb24gKGxvd2VyLCB1cHBlciwgaW5jbHVkZUxvd2VyLCBpbmNsdWRlVXBwZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHN1bW1hcnk+XHJcbiAgICAgICAgICAgICAgICAgICAgLy8vICAgICBGaWx0ZXIgb3V0IHJlY29yZHMgd2hvc2Ugd2hlcmUtZmllbGQgbGF5cyBiZXR3ZWVuIGdpdmVuIGxvd2VyIGFuZCB1cHBlciB2YWx1ZXMuIEFwcGxpZXMgdG8gU3RyaW5ncywgTnVtYmVycyBhbmQgRGF0ZXMuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8vIDwvc3VtbWFyeT5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJsb3dlclwiPjwvcGFyYW0+XHJcbiAgICAgICAgICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwidXBwZXJcIj48L3BhcmFtPlxyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cImluY2x1ZGVMb3dlclwiIG9wdGlvbmFsPVwidHJ1ZVwiPldoZXRoZXIgaXRlbXMgdGhhdCBlcXVhbHMgbG93ZXIgc2hvdWxkIGJlIGluY2x1ZGVkLiBEZWZhdWx0IHRydWUuPC9wYXJhbT5cclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJpbmNsdWRlVXBwZXJcIiBvcHRpb25hbD1cInRydWVcIj5XaGV0aGVyIGl0ZW1zIHRoYXQgZXF1YWxzIHVwcGVyIHNob3VsZCBiZSBpbmNsdWRlZC4gRGVmYXVsdCBmYWxzZS48L3BhcmFtPlxyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cmV0dXJucyB0eXBlPVwiQ29sbGVjdGlvblwiPjwvcmV0dXJucz5cclxuICAgICAgICAgICAgICAgICAgICBpbmNsdWRlTG93ZXIgPSBpbmNsdWRlTG93ZXIgIT09IGZhbHNlOyAgIC8vIERlZmF1bHQgdG8gdHJ1ZVxyXG4gICAgICAgICAgICAgICAgICAgIGluY2x1ZGVVcHBlciA9IGluY2x1ZGVVcHBlciA9PT0gdHJ1ZTsgICAgLy8gRGVmYXVsdCB0byBmYWxzZVxyXG4gICAgICAgICAgICAgICAgICAgIGlmICgobG93ZXIgPiB1cHBlcikgfHxcclxuICAgICAgICAgICAgICAgICAgICAgICAgKGxvd2VyID09PSB1cHBlciAmJiAoaW5jbHVkZUxvd2VyIHx8IGluY2x1ZGVVcHBlcikgJiYgIShpbmNsdWRlTG93ZXIgJiYgaW5jbHVkZVVwcGVyKSkpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5fY3R4LmNvbGxDbGFzcyh0aGlzLCBmdW5jdGlvbigpIHsgcmV0dXJuIElEQktleVJhbmdlLm9ubHkobG93ZXIpOyB9KS5saW1pdCgwKTsgLy8gV29ya2Fyb3VuZCBmb3IgaWRpb3RpYyBXM0MgU3BlY2lmaWNhdGlvbiB0aGF0IERhdGFFcnJvciBtdXN0IGJlIHRocm93biBpZiBsb3dlciA+IHVwcGVyLiBUaGUgbmF0dXJhbCByZXN1bHQgd291bGQgYmUgdG8gcmV0dXJuIGFuIGVtcHR5IGNvbGxlY3Rpb24uXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyB0aGlzLl9jdHguY29sbENsYXNzKHRoaXMsIGZ1bmN0aW9uKCkgeyByZXR1cm4gSURCS2V5UmFuZ2UuYm91bmQobG93ZXIsIHVwcGVyLCAhaW5jbHVkZUxvd2VyLCAhaW5jbHVkZVVwcGVyKTsgfSk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgZXF1YWxzOiBmdW5jdGlvbiAodmFsdWUpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IHRoaXMuX2N0eC5jb2xsQ2xhc3ModGhpcywgZnVuY3Rpb24oKSB7IHJldHVybiBJREJLZXlSYW5nZS5vbmx5KHZhbHVlKTsgfSk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgYWJvdmU6IGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5fY3R4LmNvbGxDbGFzcyh0aGlzLCBmdW5jdGlvbigpIHsgcmV0dXJuIElEQktleVJhbmdlLmxvd2VyQm91bmQodmFsdWUsIHRydWUpOyB9KTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBhYm92ZU9yRXF1YWw6IGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5fY3R4LmNvbGxDbGFzcyh0aGlzLCBmdW5jdGlvbigpIHsgcmV0dXJuIElEQktleVJhbmdlLmxvd2VyQm91bmQodmFsdWUpOyB9KTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBiZWxvdzogZnVuY3Rpb24gKHZhbHVlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyB0aGlzLl9jdHguY29sbENsYXNzKHRoaXMsIGZ1bmN0aW9uKCkgeyByZXR1cm4gSURCS2V5UmFuZ2UudXBwZXJCb3VuZCh2YWx1ZSwgdHJ1ZSk7IH0pO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGJlbG93T3JFcXVhbDogZnVuY3Rpb24gKHZhbHVlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyB0aGlzLl9jdHguY29sbENsYXNzKHRoaXMsIGZ1bmN0aW9uKCkgeyByZXR1cm4gSURCS2V5UmFuZ2UudXBwZXJCb3VuZCh2YWx1ZSk7IH0pO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHN0YXJ0c1dpdGg6IGZ1bmN0aW9uIChzdHIpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJzdHJcIiB0eXBlPVwiU3RyaW5nXCI+PC9wYXJhbT5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHN0ciAhPT0gJ3N0cmluZycpIHJldHVybiBmYWlsKG5ldyB0aGlzLl9jdHguY29sbENsYXNzKHRoaXMpLCBuZXcgVHlwZUVycm9yKFwiU3RyaW5nIGV4cGVjdGVkXCIpKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5iZXR3ZWVuKHN0ciwgc3RyICsgU3RyaW5nLmZyb21DaGFyQ29kZSg2NTUzNSksIHRydWUsIHRydWUpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHN0YXJ0c1dpdGhJZ25vcmVDYXNlOiBmdW5jdGlvbiAoc3RyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwic3RyXCIgdHlwZT1cIlN0cmluZ1wiPjwvcGFyYW0+XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKSByZXR1cm4gZmFpbChuZXcgdGhpcy5fY3R4LmNvbGxDbGFzcyh0aGlzKSwgbmV3IFR5cGVFcnJvcihcIlN0cmluZyBleHBlY3RlZFwiKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0ciA9PT0gXCJcIikgcmV0dXJuIHRoaXMuc3RhcnRzV2l0aChzdHIpO1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBjID0gbmV3IHRoaXMuX2N0eC5jb2xsQ2xhc3ModGhpcywgZnVuY3Rpb24oKSB7IHJldHVybiBJREJLZXlSYW5nZS5ib3VuZChzdHIudG9VcHBlckNhc2UoKSwgc3RyLnRvTG93ZXJDYXNlKCkgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKDY1NTM1KSk7IH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGFkZElnbm9yZUNhc2VBbGdvcml0aG0oYywgZnVuY3Rpb24gKGEsIGIpIHsgcmV0dXJuIGEuaW5kZXhPZihiKSA9PT0gMDsgfSwgc3RyKTtcclxuICAgICAgICAgICAgICAgICAgICBjLl9vbmRpcmVjdGlvbmNoYW5nZSA9IGZ1bmN0aW9uICgpIHsgZmFpbChjLCBuZXcgRXJyb3IoXCJyZXZlcnNlKCkgbm90IHN1cHBvcnRlZCB3aXRoIFdoZXJlQ2xhdXNlLnN0YXJ0c1dpdGhJZ25vcmVDYXNlKClcIikpOyB9O1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGVxdWFsc0lnbm9yZUNhc2U6IGZ1bmN0aW9uIChzdHIpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJzdHJcIiB0eXBlPVwiU3RyaW5nXCI+PC9wYXJhbT5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHN0ciAhPT0gJ3N0cmluZycpIHJldHVybiBmYWlsKG5ldyB0aGlzLl9jdHguY29sbENsYXNzKHRoaXMpLCBuZXcgVHlwZUVycm9yKFwiU3RyaW5nIGV4cGVjdGVkXCIpKTtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgYyA9IG5ldyB0aGlzLl9jdHguY29sbENsYXNzKHRoaXMsIGZ1bmN0aW9uKCkgeyByZXR1cm4gSURCS2V5UmFuZ2UuYm91bmQoc3RyLnRvVXBwZXJDYXNlKCksIHN0ci50b0xvd2VyQ2FzZSgpKTsgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgYWRkSWdub3JlQ2FzZUFsZ29yaXRobShjLCBmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYSA9PT0gYjsgfSwgc3RyKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYztcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBhbnlPZjogZnVuY3Rpb24gKHZhbHVlQXJyYXkpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgY3R4ID0gdGhpcy5fY3R4LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzY2hlbWEgPSBjdHgudGFibGUuc2NoZW1hO1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBpZHhTcGVjID0gY3R4LmluZGV4ID8gc2NoZW1hLmlkeEJ5TmFtZVtjdHguaW5kZXhdIDogc2NoZW1hLnByaW1LZXk7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGlzQ29tcG91bmQgPSBpZHhTcGVjICYmIGlkeFNwZWMuY29tcG91bmQ7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHNldCA9IGdldFNldEFyZ3MoYXJndW1lbnRzKTtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgY29tcGFyZSA9IGlzQ29tcG91bmQgPyBjb21wb3VuZENvbXBhcmUoYXNjZW5kaW5nKSA6IGFzY2VuZGluZztcclxuICAgICAgICAgICAgICAgICAgICBzZXQuc29ydChjb21wYXJlKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoc2V0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIG5ldyB0aGlzLl9jdHguY29sbENsYXNzKHRoaXMsIGZ1bmN0aW9uKCkgeyByZXR1cm4gSURCS2V5UmFuZ2Uub25seShcIlwiKTsgfSkubGltaXQoMCk7IC8vIFJldHVybiBhbiBlbXB0eSBjb2xsZWN0aW9uLlxyXG4gICAgICAgICAgICAgICAgICAgIHZhciBjID0gbmV3IHRoaXMuX2N0eC5jb2xsQ2xhc3ModGhpcywgZnVuY3Rpb24gKCkgeyByZXR1cm4gSURCS2V5UmFuZ2UuYm91bmQoc2V0WzBdLCBzZXRbc2V0Lmxlbmd0aCAtIDFdKTsgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgYy5fb25kaXJlY3Rpb25jaGFuZ2UgPSBmdW5jdGlvbiAoZGlyZWN0aW9uKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBhcmUgPSAoZGlyZWN0aW9uID09PSBcIm5leHRcIiA/IGFzY2VuZGluZyA6IGRlc2NlbmRpbmcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNDb21wb3VuZCkgY29tcGFyZSA9IGNvbXBvdW5kQ29tcGFyZShjb21wYXJlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0LnNvcnQoY29tcGFyZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgaSA9IDA7XHJcbiAgICAgICAgICAgICAgICAgICAgYy5fYWRkQWxnb3JpdGhtKGZ1bmN0aW9uIChjdXJzb3IsIGFkdmFuY2UsIHJlc29sdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGtleSA9IGN1cnNvci5rZXk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdoaWxlIChjb21wYXJlKGtleSwgc2V0W2ldKSA+IDApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoZSBjdXJzb3IgaGFzIHBhc3NlZCBiZXlvbmQgdGhpcyBrZXkuIENoZWNrIG5leHQuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICArK2k7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaSA9PT0gc2V0Lmxlbmd0aCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoZXJlIGlzIG5vIG5leHQuIFN0b3Agc2VhcmNoaW5nLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkdmFuY2UocmVzb2x2ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb21wYXJlKGtleSwgc2V0W2ldKSA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGN1cnJlbnQgY3Vyc29yIHZhbHVlIHNob3VsZCBiZSBpbmNsdWRlZCBhbmQgd2Ugc2hvdWxkIGNvbnRpbnVlIGEgc2luZ2xlIHN0ZXAgaW4gY2FzZSBuZXh0IGl0ZW0gaGFzIHRoZSBzYW1lIGtleSBvciBwb3NzaWJseSBvdXIgbmV4dCBrZXkgaW4gc2V0LlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWR2YW5jZShmdW5jdGlvbiAoKSB7IGN1cnNvci5jb250aW51ZSgpOyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gY3Vyc29yLmtleSBub3QgeWV0IGF0IHNldFtpXS4gRm9yd2FyZCBjdXJzb3IgdG8gdGhlIG5leHQga2V5IHRvIGh1bnQgZm9yLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWR2YW5jZShmdW5jdGlvbiAoKSB7IGN1cnNvci5jb250aW51ZShzZXRbaV0pOyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICBub3RFcXVhbDogZnVuY3Rpb24odmFsdWUpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5iZWxvdyh2YWx1ZSkub3IodGhpcy5fY3R4LmluZGV4KS5hYm92ZSh2YWx1ZSk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgICAgIG5vbmVPZjogZnVuY3Rpb24odmFsdWVBcnJheSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBjdHggPSB0aGlzLl9jdHgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNjaGVtYSA9IGN0eC50YWJsZS5zY2hlbWE7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGlkeFNwZWMgPSBjdHguaW5kZXggPyBzY2hlbWEuaWR4QnlOYW1lW2N0eC5pbmRleF0gOiBzY2hlbWEucHJpbUtleTtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgaXNDb21wb3VuZCA9IGlkeFNwZWMgJiYgaWR4U3BlYy5jb21wb3VuZDtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgc2V0ID0gZ2V0U2V0QXJncyhhcmd1bWVudHMpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzZXQubGVuZ3RoID09PSAwKSByZXR1cm4gbmV3IHRoaXMuX2N0eC5jb2xsQ2xhc3ModGhpcyk7IC8vIFJldHVybiBlbnRpcmUgY29sbGVjdGlvbi5cclxuICAgICAgICAgICAgICAgICAgICB2YXIgY29tcGFyZSA9IGlzQ29tcG91bmQgPyBjb21wb3VuZENvbXBhcmUoYXNjZW5kaW5nKSA6IGFzY2VuZGluZztcclxuICAgICAgICAgICAgICAgICAgICBzZXQuc29ydChjb21wYXJlKTtcclxuICAgICAgICAgICAgICAgICAgICAvLyBUcmFuc2Zvcm0gW1wiYVwiLFwiYlwiLFwiY1wiXSB0byBhIHNldCBvZiByYW5nZXMgZm9yIGJldHdlZW4vYWJvdmUvYmVsb3c6IFtbbnVsbCxcImFcIl0sIFtcImFcIixcImJcIl0sIFtcImJcIixcImNcIl0sIFtcImNcIixudWxsXV1cclxuICAgICAgICAgICAgICAgICAgICB2YXIgcmFuZ2VzID0gc2V0LnJlZHVjZShmdW5jdGlvbiAocmVzLCB2YWwpIHsgcmV0dXJuIHJlcyA/IHJlcy5jb25jYXQoW1tyZXNbcmVzLmxlbmd0aCAtIDFdWzFdLCB2YWxdXSkgOiBbW251bGwsIHZhbF1dOyB9LCBudWxsKTtcclxuICAgICAgICAgICAgICAgICAgICByYW5nZXMucHVzaChbc2V0W3NldC5sZW5ndGggLSAxXSwgbnVsbF0pO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFRyYW5zZm9ybSByYW5nZS1zZXRzIHRvIGEgYmlnIG9yKCkgZXhwcmVzc2lvbiBiZXR3ZWVuIHJhbmdlczpcclxuICAgICAgICAgICAgICAgICAgICB2YXIgdGhpeiA9IHRoaXMsIGluZGV4ID0gY3R4LmluZGV4O1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByYW5nZXMucmVkdWNlKGZ1bmN0aW9uKGNvbGxlY3Rpb24sIHJhbmdlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBjb2xsZWN0aW9uID9cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJhbmdlWzFdID09PSBudWxsID9cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xsZWN0aW9uLm9yKGluZGV4KS5hYm92ZShyYW5nZVswXSkgOlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxlY3Rpb24ub3IoaW5kZXgpLmJldHdlZW4ocmFuZ2VbMF0sIHJhbmdlWzFdLCBmYWxzZSwgZmFsc2UpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IHRoaXouYmVsb3cocmFuZ2VbMV0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0sIG51bGwpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICBzdGFydHNXaXRoQW55T2Y6IGZ1bmN0aW9uICh2YWx1ZUFycmF5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN0eCA9IHRoaXMuX2N0eCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0ID0gZ2V0U2V0QXJncyhhcmd1bWVudHMpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXNldC5ldmVyeShmdW5jdGlvbiAocykgeyByZXR1cm4gdHlwZW9mIHMgPT09ICdzdHJpbmcnOyB9KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFpbChuZXcgY3R4LmNvbGxDbGFzcyh0aGlzKSwgbmV3IFR5cGVFcnJvcihcInN0YXJ0c1dpdGhBbnlPZigpIG9ubHkgd29ya3Mgd2l0aCBzdHJpbmdzXCIpKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNldC5sZW5ndGggPT09IDApIHJldHVybiBuZXcgY3R4LmNvbGxDbGFzcyh0aGlzLCBmdW5jdGlvbiAoKSB7IHJldHVybiBJREJLZXlSYW5nZS5vbmx5KFwiXCIpOyB9KS5saW1pdCgwKTsgLy8gUmV0dXJuIGFuIGVtcHR5IGNvbGxlY3Rpb24uXHJcblxyXG4gICAgICAgICAgICAgICAgICAgIHZhciBzZXRFbmRzID0gc2V0Lm1hcChmdW5jdGlvbiAocykgeyByZXR1cm4gcyArIFN0cmluZy5mcm9tQ2hhckNvZGUoNjU1MzUpOyB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICB2YXIgc29ydERpcmVjdGlvbiA9IGFzY2VuZGluZztcclxuICAgICAgICAgICAgICAgICAgICBzZXQuc29ydChzb3J0RGlyZWN0aW9uKTtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgaSA9IDA7XHJcbiAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb24ga2V5SXNCZXlvbmRDdXJyZW50RW50cnkoa2V5KSB7IHJldHVybiBrZXkgPiBzZXRFbmRzW2ldOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb24ga2V5SXNCZWZvcmVDdXJyZW50RW50cnkoa2V5KSB7IHJldHVybiBrZXkgPCBzZXRbaV07IH1cclxuICAgICAgICAgICAgICAgICAgICB2YXIgY2hlY2tLZXkgPSBrZXlJc0JleW9uZEN1cnJlbnRFbnRyeTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGMgPSBuZXcgY3R4LmNvbGxDbGFzcyh0aGlzLCBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBJREJLZXlSYW5nZS5ib3VuZChzZXRbMF0sIHNldFtzZXQubGVuZ3RoIC0gMV0gKyBTdHJpbmcuZnJvbUNoYXJDb2RlKDY1NTM1KSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgYy5fb25kaXJlY3Rpb25jaGFuZ2UgPSBmdW5jdGlvbiAoZGlyZWN0aW9uKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT09IFwibmV4dFwiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGVja0tleSA9IGtleUlzQmV5b25kQ3VycmVudEVudHJ5O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc29ydERpcmVjdGlvbiA9IGFzY2VuZGluZztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoZWNrS2V5ID0ga2V5SXNCZWZvcmVDdXJyZW50RW50cnk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzb3J0RGlyZWN0aW9uID0gZGVzY2VuZGluZztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXQuc29ydChzb3J0RGlyZWN0aW9uKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0RW5kcy5zb3J0KHNvcnREaXJlY3Rpb24pO1xyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGMuX2FkZEFsZ29yaXRobShmdW5jdGlvbiAoY3Vyc29yLCBhZHZhbmNlLCByZXNvbHZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBrZXkgPSBjdXJzb3Iua2V5O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aGlsZSAoY2hlY2tLZXkoa2V5KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGN1cnNvciBoYXMgcGFzc2VkIGJleW9uZCB0aGlzIGtleS4gQ2hlY2sgbmV4dC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICsraTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpID09PSBzZXQubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhlcmUgaXMgbm8gbmV4dC4gU3RvcCBzZWFyY2hpbmcuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWR2YW5jZShyZXNvbHZlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGtleSA+PSBzZXRbaV0gJiYga2V5IDw9IHNldEVuZHNbaV0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoZSBjdXJyZW50IGN1cnNvciB2YWx1ZSBzaG91bGQgYmUgaW5jbHVkZWQgYW5kIHdlIHNob3VsZCBjb250aW51ZSBhIHNpbmdsZSBzdGVwIGluIGNhc2UgbmV4dCBpdGVtIGhhcyB0aGUgc2FtZSBrZXkgb3IgcG9zc2libHkgb3VyIG5leHQga2V5IGluIHNldC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkdmFuY2UoZnVuY3Rpb24gKCkgeyBjdXJzb3IuY29udGludWUoKTsgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGN1cnNvci5rZXkgbm90IHlldCBhdCBzZXRbaV0uIEZvcndhcmQgY3Vyc29yIHRvIHRoZSBuZXh0IGtleSB0byBodW50IGZvci5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkdmFuY2UoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNvcnREaXJlY3Rpb24gPT09IGFzY2VuZGluZykgY3Vyc29yLmNvbnRpbnVlKHNldFtpXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBjdXJzb3IuY29udGludWUoc2V0RW5kc1tpXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0pO1xyXG5cclxuXHJcblxyXG5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyBDb2xsZWN0aW9uIENsYXNzXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgZnVuY3Rpb24gQ29sbGVjdGlvbih3aGVyZUNsYXVzZSwga2V5UmFuZ2VHZW5lcmF0b3IpIHtcclxuICAgICAgICAgICAgLy8vIDxzdW1tYXJ5PlxyXG4gICAgICAgICAgICAvLy8gXHJcbiAgICAgICAgICAgIC8vLyA8L3N1bW1hcnk+XHJcbiAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cIndoZXJlQ2xhdXNlXCIgdHlwZT1cIldoZXJlQ2xhdXNlXCI+V2hlcmUgY2xhdXNlIGluc3RhbmNlPC9wYXJhbT5cclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwia2V5UmFuZ2VHZW5lcmF0b3JcIiB2YWx1ZT1cImZ1bmN0aW9uKCl7IHJldHVybiBJREJLZXlSYW5nZS5ib3VuZCgwLDEpO31cIiBvcHRpb25hbD1cInRydWVcIj48L3BhcmFtPlxyXG4gICAgICAgICAgICB2YXIga2V5UmFuZ2UgPSBudWxsLCBlcnJvciA9IG51bGw7XHJcbiAgICAgICAgICAgIGlmIChrZXlSYW5nZUdlbmVyYXRvcikgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGtleVJhbmdlID0ga2V5UmFuZ2VHZW5lcmF0b3IoKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXgpIHtcclxuICAgICAgICAgICAgICAgIGVycm9yID0gZXg7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHZhciB3aGVyZUN0eCA9IHdoZXJlQ2xhdXNlLl9jdHg7XHJcbiAgICAgICAgICAgIHRoaXMuX2N0eCA9IHtcclxuICAgICAgICAgICAgICAgIHRhYmxlOiB3aGVyZUN0eC50YWJsZSxcclxuICAgICAgICAgICAgICAgIGluZGV4OiB3aGVyZUN0eC5pbmRleCxcclxuICAgICAgICAgICAgICAgIGlzUHJpbUtleTogKCF3aGVyZUN0eC5pbmRleCB8fCAod2hlcmVDdHgudGFibGUuc2NoZW1hLnByaW1LZXkua2V5UGF0aCAmJiB3aGVyZUN0eC5pbmRleCA9PT0gd2hlcmVDdHgudGFibGUuc2NoZW1hLnByaW1LZXkubmFtZSkpLFxyXG4gICAgICAgICAgICAgICAgcmFuZ2U6IGtleVJhbmdlLFxyXG4gICAgICAgICAgICAgICAgb3A6IFwib3BlbkN1cnNvclwiLFxyXG4gICAgICAgICAgICAgICAgZGlyOiBcIm5leHRcIixcclxuICAgICAgICAgICAgICAgIHVuaXF1ZTogXCJcIixcclxuICAgICAgICAgICAgICAgIGFsZ29yaXRobTogbnVsbCxcclxuICAgICAgICAgICAgICAgIGZpbHRlcjogbnVsbCxcclxuICAgICAgICAgICAgICAgIGlzTWF0Y2g6IG51bGwsXHJcbiAgICAgICAgICAgICAgICBvZmZzZXQ6IDAsXHJcbiAgICAgICAgICAgICAgICBsaW1pdDogSW5maW5pdHksXHJcbiAgICAgICAgICAgICAgICBlcnJvcjogZXJyb3IsIC8vIElmIHNldCwgYW55IHByb21pc2UgbXVzdCBiZSByZWplY3RlZCB3aXRoIHRoaXMgZXJyb3JcclxuICAgICAgICAgICAgICAgIG9yOiB3aGVyZUN0eC5vclxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZXh0ZW5kKENvbGxlY3Rpb24ucHJvdG90eXBlLCBmdW5jdGlvbiAoKSB7XHJcblxyXG4gICAgICAgICAgICAvL1xyXG4gICAgICAgICAgICAvLyBDb2xsZWN0aW9uIFByaXZhdGUgRnVuY3Rpb25zXHJcbiAgICAgICAgICAgIC8vXHJcblxyXG4gICAgICAgICAgICBmdW5jdGlvbiBhZGRGaWx0ZXIoY3R4LCBmbikge1xyXG4gICAgICAgICAgICAgICAgY3R4LmZpbHRlciA9IGNvbWJpbmUoY3R4LmZpbHRlciwgZm4pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBmdW5jdGlvbiBhZGRNYXRjaEZpbHRlcihjdHgsIGZuKSB7XHJcbiAgICAgICAgICAgICAgICBjdHguaXNNYXRjaCA9IGNvbWJpbmUoY3R4LmlzTWF0Y2gsIGZuKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgZnVuY3Rpb24gZ2V0SW5kZXhPclN0b3JlKGN0eCwgc3RvcmUpIHtcclxuICAgICAgICAgICAgICAgIGlmIChjdHguaXNQcmltS2V5KSByZXR1cm4gc3RvcmU7XHJcbiAgICAgICAgICAgICAgICB2YXIgaW5kZXhTcGVjID0gY3R4LnRhYmxlLnNjaGVtYS5pZHhCeU5hbWVbY3R4LmluZGV4XTtcclxuICAgICAgICAgICAgICAgIGlmICghaW5kZXhTcGVjKSB0aHJvdyBuZXcgRXJyb3IoXCJLZXlQYXRoIFwiICsgY3R4LmluZGV4ICsgXCIgb24gb2JqZWN0IHN0b3JlIFwiICsgc3RvcmUubmFtZSArIFwiIGlzIG5vdCBpbmRleGVkXCIpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGN0eC5pc1ByaW1LZXkgPyBzdG9yZSA6IHN0b3JlLmluZGV4KGluZGV4U3BlYy5uYW1lKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgZnVuY3Rpb24gb3BlbkN1cnNvcihjdHgsIHN0b3JlKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZ2V0SW5kZXhPclN0b3JlKGN0eCwgc3RvcmUpW2N0eC5vcF0oY3R4LnJhbmdlIHx8IG51bGwsIGN0eC5kaXIgKyBjdHgudW5pcXVlKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgZnVuY3Rpb24gaXRlcihjdHgsIGZuLCByZXNvbHZlLCByZWplY3QsIGlkYnN0b3JlKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIWN0eC5vcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGl0ZXJhdGUob3BlbkN1cnNvcihjdHgsIGlkYnN0b3JlKSwgY29tYmluZShjdHguYWxnb3JpdGhtLCBjdHguZmlsdGVyKSwgZm4sIHJlc29sdmUsIHJlamVjdCwgY3R4LnRhYmxlLmhvb2sucmVhZGluZy5maXJlKTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGZpbHRlciA9IGN0eC5maWx0ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBzZXQgPSB7fTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHByaW1LZXkgPSBjdHgudGFibGUuc2NoZW1hLnByaW1LZXkua2V5UGF0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHJlc29sdmVkID0gMDtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uIHJlc29sdmVib3RoKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCsrcmVzb2x2ZWQgPT09IDIpIHJlc29sdmUoKTsgLy8gU2VlbXMgbGlrZSB3ZSBqdXN0IHN1cHBvcnQgb3IgYnR3biBtYXggMiBleHByZXNzaW9ucywgYnV0IHRoZXJlIGFyZSBubyBsaW1pdCBiZWNhdXNlIHdlIGRvIHJlY3Vyc2lvbi5cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb24gdW5pb24oaXRlbSwgY3Vyc29yLCBhZHZhbmNlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWZpbHRlciB8fCBmaWx0ZXIoY3Vyc29yLCBhZHZhbmNlLCByZXNvbHZlYm90aCwgcmVqZWN0KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBrZXkgPSBjdXJzb3IucHJpbWFyeUtleS50b1N0cmluZygpOyAvLyBDb252ZXJ0cyBhbnkgRGF0ZSB0byBTdHJpbmcsIFN0cmluZyB0byBTdHJpbmcsIE51bWJlciB0byBTdHJpbmcgYW5kIEFycmF5IHRvIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmdcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXNldC5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldFtrZXldID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm4oaXRlbSwgY3Vyc29yLCBhZHZhbmNlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5vci5faXRlcmF0ZSh1bmlvbiwgcmVzb2x2ZWJvdGgsIHJlamVjdCwgaWRic3RvcmUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpdGVyYXRlKG9wZW5DdXJzb3IoY3R4LCBpZGJzdG9yZSksIGN0eC5hbGdvcml0aG0sIHVuaW9uLCByZXNvbHZlYm90aCwgcmVqZWN0LCBjdHgudGFibGUuaG9vay5yZWFkaW5nLmZpcmUpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pKCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZnVuY3Rpb24gZ2V0SW5zdGFuY2VUZW1wbGF0ZShjdHgpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBjdHgudGFibGUuc2NoZW1hLmluc3RhbmNlVGVtcGxhdGU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcblxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG5cclxuICAgICAgICAgICAgICAgIC8vXHJcbiAgICAgICAgICAgICAgICAvLyBDb2xsZWN0aW9uIFByb3RlY3RlZCBGdW5jdGlvbnNcclxuICAgICAgICAgICAgICAgIC8vXHJcblxyXG4gICAgICAgICAgICAgICAgX3JlYWQ6IGZ1bmN0aW9uIChmbiwgY2IpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgY3R4ID0gdGhpcy5fY3R4O1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChjdHguZXJyb3IpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBjdHgudGFibGUuX3RyYW5zKG51bGwsIGZ1bmN0aW9uIHJlamVjdG9yKHJlc29sdmUsIHJlamVjdCkgeyByZWplY3QoY3R4LmVycm9yKTsgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gY3R4LnRhYmxlLl9pZGJzdG9yZShSRUFET05MWSwgZm4pLnRoZW4oY2IpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIF93cml0ZTogZnVuY3Rpb24gKGZuKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN0eCA9IHRoaXMuX2N0eDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoY3R4LmVycm9yKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gY3R4LnRhYmxlLl90cmFucyhudWxsLCBmdW5jdGlvbiByZWplY3RvcihyZXNvbHZlLCByZWplY3QpIHsgcmVqZWN0KGN0eC5lcnJvcik7IH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGVsc2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGN0eC50YWJsZS5faWRic3RvcmUoUkVBRFdSSVRFLCBmbiwgXCJsb2NrZWRcIik7IC8vIFdoZW4gZG9pbmcgd3JpdGUgb3BlcmF0aW9ucyBvbiBjb2xsZWN0aW9ucywgYWx3YXlzIGxvY2sgdGhlIG9wZXJhdGlvbiBzbyB0aGF0IHVwY29taW5nIG9wZXJhdGlvbnMgZ2V0cyBxdWV1ZWQuXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgX2FkZEFsZ29yaXRobTogZnVuY3Rpb24gKGZuKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN0eCA9IHRoaXMuX2N0eDtcclxuICAgICAgICAgICAgICAgICAgICBjdHguYWxnb3JpdGhtID0gY29tYmluZShjdHguYWxnb3JpdGhtLCBmbik7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgICAgIF9pdGVyYXRlOiBmdW5jdGlvbiAoZm4sIHJlc29sdmUsIHJlamVjdCwgaWRic3RvcmUpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaXRlcih0aGlzLl9jdHgsIGZuLCByZXNvbHZlLCByZWplY3QsIGlkYnN0b3JlKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcblxyXG4gICAgICAgICAgICAgICAgLy9cclxuICAgICAgICAgICAgICAgIC8vIENvbGxlY3Rpb24gUHVibGljIG1ldGhvZHNcclxuICAgICAgICAgICAgICAgIC8vXHJcblxyXG4gICAgICAgICAgICAgICAgZWFjaDogZnVuY3Rpb24gKGZuKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN0eCA9IHRoaXMuX2N0eDtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgZmFrZSAmJiBmbihnZXRJbnN0YW5jZVRlbXBsYXRlKGN0eCkpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fcmVhZChmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0LCBpZGJzdG9yZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpdGVyKGN0eCwgZm4sIHJlc29sdmUsIHJlamVjdCwgaWRic3RvcmUpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICBjb3VudDogZnVuY3Rpb24gKGNiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZha2UpIHJldHVybiBQcm9taXNlLnJlc29sdmUoMCkudGhlbihjYik7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjdHggPSB0aGlzLl9jdHg7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChjdHguZmlsdGVyIHx8IGN0eC5hbGdvcml0aG0gfHwgY3R4Lm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdoZW4gZmlsdGVycyBhcmUgYXBwbGllZCBvciAnb3JlZCcgY29sbGVjdGlvbnMgYXJlIHVzZWQsIHdlIG11c3QgY291bnQgbWFudWFsbHlcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGNvdW50ID0gMDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JlYWQoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCwgaWRic3RvcmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZXIoY3R4LCBmdW5jdGlvbiAoKSB7ICsrY291bnQ7IHJldHVybiBmYWxzZTsgfSwgZnVuY3Rpb24gKCkgeyByZXNvbHZlKGNvdW50KTsgfSwgcmVqZWN0LCBpZGJzdG9yZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sIGNiKTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBPdGhlcndpc2UsIHdlIGNhbiB1c2UgdGhlIGNvdW50KCkgbWV0aG9kIGlmIHRoZSBpbmRleC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JlYWQoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCwgaWRic3RvcmUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBpZHggPSBnZXRJbmRleE9yU3RvcmUoY3R4LCBpZGJzdG9yZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVxID0gKGN0eC5yYW5nZSA/IGlkeC5jb3VudChjdHgucmFuZ2UpIDogaWR4LmNvdW50KCkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxLm9uZXJyb3IgPSBldmVudFJlamVjdEhhbmRsZXIocmVqZWN0LCBbXCJjYWxsaW5nXCIsIFwiY291bnQoKVwiLCBcIm9uXCIsIHNlbGYubmFtZV0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxLm9uc3VjY2VzcyA9IGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShNYXRoLm1pbihlLnRhcmdldC5yZXN1bHQsIE1hdGgubWF4KDAsIGN0eC5saW1pdCAtIGN0eC5vZmZzZXQpKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LCBjYik7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICBzb3J0Qnk6IGZ1bmN0aW9uIChrZXlQYXRoLCBjYikge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cImtleVBhdGhcIiB0eXBlPVwiU3RyaW5nXCI+PC9wYXJhbT5cclxuICAgICAgICAgICAgICAgICAgICB2YXIgY3R4ID0gdGhpcy5fY3R4O1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBwYXJ0cyA9IGtleVBhdGguc3BsaXQoJy4nKS5yZXZlcnNlKCksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RQYXJ0ID0gcGFydHNbMF0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RJbmRleCA9IHBhcnRzLmxlbmd0aCAtIDE7XHJcbiAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb24gZ2V0dmFsKG9iaiwgaSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaSkgcmV0dXJuIGdldHZhbChvYmpbcGFydHNbaV1dLCBpIC0gMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBvYmpbbGFzdFBhcnRdO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB2YXIgb3JkZXIgPSB0aGlzLl9jdHguZGlyID09PSBcIm5leHRcIiA/IDEgOiAtMTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb24gc29ydGVyKGEsIGIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGFWYWwgPSBnZXR2YWwoYSwgbGFzdEluZGV4KSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJWYWwgPSBnZXR2YWwoYiwgbGFzdEluZGV4KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFWYWwgPCBiVmFsID8gLW9yZGVyIDogYVZhbCA+IGJWYWwgPyBvcmRlciA6IDA7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnRvQXJyYXkoZnVuY3Rpb24gKGEpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGEuc29ydChzb3J0ZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLnRoZW4oY2IpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICB0b0FycmF5OiBmdW5jdGlvbiAoY2IpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgY3R4ID0gdGhpcy5fY3R4O1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLl9yZWFkKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QsIGlkYnN0b3JlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZha2UgJiYgcmVzb2x2ZShbZ2V0SW5zdGFuY2VUZW1wbGF0ZShjdHgpXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBhID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGl0ZXIoY3R4LCBmdW5jdGlvbiAoaXRlbSkgeyBhLnB1c2goaXRlbSk7IH0sIGZ1bmN0aW9uIGFycmF5Q29tcGxldGUoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKGEpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LCByZWplY3QsIGlkYnN0b3JlKTtcclxuICAgICAgICAgICAgICAgICAgICB9LCBjYik7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgICAgIG9mZnNldDogZnVuY3Rpb24gKG9mZnNldCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBjdHggPSB0aGlzLl9jdHg7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9mZnNldCA8PSAwKSByZXR1cm4gdGhpcztcclxuICAgICAgICAgICAgICAgICAgICBjdHgub2Zmc2V0ICs9IG9mZnNldDsgLy8gRm9yIGNvdW50KClcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWN0eC5vciAmJiAhY3R4LmFsZ29yaXRobSAmJiAhY3R4LmZpbHRlcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhZGRGaWx0ZXIoY3R4LCBmdW5jdGlvbiBvZmZzZXRGaWx0ZXIoY3Vyc29yLCBhZHZhbmNlLCByZXNvbHZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAob2Zmc2V0ID09PSAwKSByZXR1cm4gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvZmZzZXQgPT09IDEpIHsgLS1vZmZzZXQ7IHJldHVybiBmYWxzZTsgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWR2YW5jZShmdW5jdGlvbiAoKSB7IGN1cnNvci5hZHZhbmNlKG9mZnNldCk7IG9mZnNldCA9IDA7IH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhZGRGaWx0ZXIoY3R4LCBmdW5jdGlvbiBvZmZzZXRGaWx0ZXIoY3Vyc29yLCBhZHZhbmNlLCByZXNvbHZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gKC0tb2Zmc2V0IDwgMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcztcclxuICAgICAgICAgICAgICAgIH0sXHJcblxyXG4gICAgICAgICAgICAgICAgbGltaXQ6IGZ1bmN0aW9uIChudW1Sb3dzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY3R4LmxpbWl0ID0gTWF0aC5taW4odGhpcy5fY3R4LmxpbWl0LCBudW1Sb3dzKTsgLy8gRm9yIGNvdW50KClcclxuICAgICAgICAgICAgICAgICAgICBhZGRGaWx0ZXIodGhpcy5fY3R4LCBmdW5jdGlvbiAoY3Vyc29yLCBhZHZhbmNlLCByZXNvbHZlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgtLW51bVJvd3MgPD0gMCkgYWR2YW5jZShyZXNvbHZlKTsgLy8gU3RvcCBhZnRlciB0aGlzIGl0ZW0gaGFzIGJlZW4gaW5jbHVkZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bVJvd3MgPj0gMDsgLy8gSWYgbnVtUm93cyBpcyBhbHJlYWR5IGJlbG93IDAsIHJldHVybiBmYWxzZSBiZWNhdXNlIHRoZW4gMCB3YXMgcGFzc2VkIHRvIG51bVJvd3MgaW5pdGlhbGx5LiBPdGhlcndpc2Ugd2Ugd291bGRudCBjb21lIGhlcmUuXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgICAgIHVudGlsOiBmdW5jdGlvbiAoZmlsdGVyRnVuY3Rpb24sIGJJbmNsdWRlU3RvcEVudHJ5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN0eCA9IHRoaXMuX2N0eDtcclxuICAgICAgICAgICAgICAgICAgICBmYWtlICYmIGZpbHRlckZ1bmN0aW9uKGdldEluc3RhbmNlVGVtcGxhdGUoY3R4KSk7XHJcbiAgICAgICAgICAgICAgICAgICAgYWRkRmlsdGVyKHRoaXMuX2N0eCwgZnVuY3Rpb24gKGN1cnNvciwgYWR2YW5jZSwgcmVzb2x2ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmlsdGVyRnVuY3Rpb24oY3Vyc29yLnZhbHVlKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWR2YW5jZShyZXNvbHZlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBiSW5jbHVkZVN0b3BFbnRyeTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgICAgIGZpcnN0OiBmdW5jdGlvbiAoY2IpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5saW1pdCgxKS50b0FycmF5KGZ1bmN0aW9uIChhKSB7IHJldHVybiBhWzBdOyB9KS50aGVuKGNiKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcblxyXG4gICAgICAgICAgICAgICAgbGFzdDogZnVuY3Rpb24gKGNiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucmV2ZXJzZSgpLmZpcnN0KGNiKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcblxyXG4gICAgICAgICAgICAgICAgYW5kOiBmdW5jdGlvbiAoZmlsdGVyRnVuY3Rpb24pIHtcclxuICAgICAgICAgICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJqc0Z1bmN0aW9uRmlsdGVyXCIgdHlwZT1cIkZ1bmN0aW9uXCI+ZnVuY3Rpb24odmFsKXtyZXR1cm4gdHJ1ZS9mYWxzZX08L3BhcmFtPlxyXG4gICAgICAgICAgICAgICAgICAgIGZha2UgJiYgZmlsdGVyRnVuY3Rpb24oZ2V0SW5zdGFuY2VUZW1wbGF0ZSh0aGlzLl9jdHgpKTtcclxuICAgICAgICAgICAgICAgICAgICBhZGRGaWx0ZXIodGhpcy5fY3R4LCBmdW5jdGlvbiAoY3Vyc29yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmaWx0ZXJGdW5jdGlvbihjdXJzb3IudmFsdWUpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGFkZE1hdGNoRmlsdGVyKHRoaXMuX2N0eCwgZmlsdGVyRnVuY3Rpb24pOyAvLyBtYXRjaCBmaWx0ZXJzIG5vdCB1c2VkIGluIERleGllLmpzIGJ1dCBjYW4gYmUgdXNlZCBieSAzcmQgcGFydCBsaWJyYXJpZXMgdG8gdGVzdCBhIGNvbGxlY3Rpb24gZm9yIGEgbWF0Y2ggd2l0aG91dCBxdWVyeWluZyBEQi4gVXNlZCBieSBEZXhpZS5PYnNlcnZhYmxlLlxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICBvcjogZnVuY3Rpb24gKGluZGV4TmFtZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgV2hlcmVDbGF1c2UodGhpcy5fY3R4LnRhYmxlLCBpbmRleE5hbWUsIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICByZXZlcnNlOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY3R4LmRpciA9ICh0aGlzLl9jdHguZGlyID09PSBcInByZXZcIiA/IFwibmV4dFwiIDogXCJwcmV2XCIpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9vbmRpcmVjdGlvbmNoYW5nZSkgdGhpcy5fb25kaXJlY3Rpb25jaGFuZ2UodGhpcy5fY3R4LmRpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgICAgIGRlc2M6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZXZlcnNlKCk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgICAgIGVhY2hLZXk6IGZ1bmN0aW9uIChjYikge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBjdHggPSB0aGlzLl9jdHg7XHJcbiAgICAgICAgICAgICAgICAgICAgZmFrZSAmJiBjYihnZXRCeUtleVBhdGgoZ2V0SW5zdGFuY2VUZW1wbGF0ZSh0aGlzLl9jdHgpLCB0aGlzLl9jdHguaW5kZXggPyB0aGlzLl9jdHgudGFibGUuc2NoZW1hLmlkeEJ5TmFtZVt0aGlzLl9jdHguaW5kZXhdLmtleVBhdGggOiB0aGlzLl9jdHgudGFibGUuc2NoZW1hLnByaW1LZXkua2V5UGF0aCkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghY3R4LmlzUHJpbUtleSkgY3R4Lm9wID0gXCJvcGVuS2V5Q3Vyc29yXCI7IC8vIE5lZWQgdGhlIGNoZWNrIGJlY2F1c2UgSURCT2JqZWN0U3RvcmUgZG9lcyBub3QgaGF2ZSBcIm9wZW5LZXlDdXJzb3IoKVwiIHdoaWxlIElEQkluZGV4IGhhcy5cclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5lYWNoKGZ1bmN0aW9uICh2YWwsIGN1cnNvcikgeyBjYihjdXJzb3Iua2V5LCBjdXJzb3IpOyB9KTtcclxuICAgICAgICAgICAgICAgIH0sXHJcblxyXG4gICAgICAgICAgICAgICAgZWFjaFVuaXF1ZUtleTogZnVuY3Rpb24gKGNiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fY3R4LnVuaXF1ZSA9IFwidW5pcXVlXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZWFjaEtleShjYik7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgICAgIGtleXM6IGZ1bmN0aW9uIChjYikge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBjdHggPSB0aGlzLl9jdHg7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFjdHguaXNQcmltS2V5KSBjdHgub3AgPSBcIm9wZW5LZXlDdXJzb3JcIjsgLy8gTmVlZCB0aGUgY2hlY2sgYmVjYXVzZSBJREJPYmplY3RTdG9yZSBkb2VzIG5vdCBoYXZlIFwib3BlbktleUN1cnNvcigpXCIgd2hpbGUgSURCSW5kZXggaGFzLlxyXG4gICAgICAgICAgICAgICAgICAgIHZhciBhID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZha2UpIHJldHVybiBuZXcgUHJvbWlzZSh0aGlzLmVhY2hLZXkuYmluZCh0aGlzKSkudGhlbihmdW5jdGlvbih4KSB7IHJldHVybiBbeF07IH0pLnRoZW4oY2IpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmVhY2goZnVuY3Rpb24gKGl0ZW0sIGN1cnNvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhLnB1c2goY3Vyc29yLmtleSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSkudGhlbihmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLnRoZW4oY2IpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICB1bmlxdWVLZXlzOiBmdW5jdGlvbiAoY2IpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jdHgudW5pcXVlID0gXCJ1bmlxdWVcIjtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5rZXlzKGNiKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcblxyXG4gICAgICAgICAgICAgICAgZmlyc3RLZXk6IGZ1bmN0aW9uIChjYikge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmxpbWl0KDEpLmtleXMoZnVuY3Rpb24gKGEpIHsgcmV0dXJuIGFbMF07IH0pLnRoZW4oY2IpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICBsYXN0S2V5OiBmdW5jdGlvbiAoY2IpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZXZlcnNlKCkuZmlyc3RLZXkoY2IpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcblxyXG4gICAgICAgICAgICAgICAgZGlzdGluY3Q6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgc2V0ID0ge307XHJcbiAgICAgICAgICAgICAgICAgICAgYWRkRmlsdGVyKHRoaXMuX2N0eCwgZnVuY3Rpb24gKGN1cnNvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgc3RyS2V5ID0gY3Vyc29yLnByaW1hcnlLZXkudG9TdHJpbmcoKTsgLy8gQ29udmVydHMgYW55IERhdGUgdG8gU3RyaW5nLCBTdHJpbmcgdG8gU3RyaW5nLCBOdW1iZXIgdG8gU3RyaW5nIGFuZCBBcnJheSB0byBjb21tYS1zZXBhcmF0ZWQgc3RyaW5nXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBmb3VuZCA9IHNldC5oYXNPd25Qcm9wZXJ0eShzdHJLZXkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRbc3RyS2V5XSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAhZm91bmQ7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyBXcml0ZWFibGVDb2xsZWN0aW9uIENsYXNzXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIGZ1bmN0aW9uIFdyaXRlYWJsZUNvbGxlY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIENvbGxlY3Rpb24uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGRlcml2ZShXcml0ZWFibGVDb2xsZWN0aW9uKS5mcm9tKENvbGxlY3Rpb24pLmV4dGVuZCh7XHJcblxyXG4gICAgICAgICAgICAvL1xyXG4gICAgICAgICAgICAvLyBXcml0ZWFibGVDb2xsZWN0aW9uIFB1YmxpYyBNZXRob2RzXHJcbiAgICAgICAgICAgIC8vXHJcblxyXG4gICAgICAgICAgICBtb2RpZnk6IGZ1bmN0aW9uIChjaGFuZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXMsXHJcbiAgICAgICAgICAgICAgICAgICAgY3R4ID0gdGhpcy5fY3R4LFxyXG4gICAgICAgICAgICAgICAgICAgIGhvb2sgPSBjdHgudGFibGUuaG9vayxcclxuICAgICAgICAgICAgICAgICAgICB1cGRhdGluZ0hvb2sgPSBob29rLnVwZGF0aW5nLmZpcmUsXHJcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRpbmdIb29rID0gaG9vay5kZWxldGluZy5maXJlO1xyXG5cclxuICAgICAgICAgICAgICAgIGZha2UgJiYgdHlwZW9mIGNoYW5nZXMgPT09ICdmdW5jdGlvbicgJiYgY2hhbmdlcy5jYWxsKHsgdmFsdWU6IGN0eC50YWJsZS5zY2hlbWEuaW5zdGFuY2VUZW1wbGF0ZSB9LCBjdHgudGFibGUuc2NoZW1hLmluc3RhbmNlVGVtcGxhdGUpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLl93cml0ZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0LCBpZGJzdG9yZSwgdHJhbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgbW9kaWZ5ZXI7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBjaGFuZ2VzID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoYW5nZXMgaXMgYSBmdW5jdGlvbiB0aGF0IG1heSB1cGRhdGUsIGFkZCBvciBkZWxldGUgcHJvcHRlcnRpZXMgb3IgZXZlbiByZXF1aXJlIGEgZGVsZXRpb24gdGhlIG9iamVjdCBpdHNlbGYgKGRlbGV0ZSB0aGlzLml0ZW0pXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1cGRhdGluZ0hvb2sgPT09IG5vcCAmJiBkZWxldGluZ0hvb2sgPT09IG5vcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gTm9vbmUgY2FyZXMgYWJvdXQgd2hhdCBpcyBiZWluZyBjaGFuZ2VkLiBKdXN0IGxldCB0aGUgbW9kaWZpZXIgZnVuY3Rpb24gYmUgdGhlIGdpdmVuIGFyZ3VtZW50IGFzIGlzLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kaWZ5ZXIgPSBjaGFuZ2VzO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUGVvcGxlIHdhbnQgdG8ga25vdyBleGFjdGx5IHdoYXQgaXMgYmVpbmcgbW9kaWZpZWQgb3IgZGVsZXRlZC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIExldCBtb2RpZnllciBiZSBhIHByb3h5IGZ1bmN0aW9uIHRoYXQgZmluZHMgb3V0IHdoYXQgY2hhbmdlcyB0aGUgY2FsbGVyIGlzIGFjdHVhbGx5IGRvaW5nXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhbmQgY2FsbCB0aGUgaG9va3MgYWNjb3JkaW5nbHkhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RpZnllciA9IGZ1bmN0aW9uIChpdGVtKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIG9yaWdJdGVtID0gZGVlcENsb25lKGl0ZW0pOyAvLyBDbG9uZSB0aGUgaXRlbSBmaXJzdCBzbyB3ZSBjYW4gY29tcGFyZSBsYXRlcnMuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNoYW5nZXMuY2FsbCh0aGlzLCBpdGVtKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTsgLy8gQ2FsbCB0aGUgcmVhbCBtb2RpZnllciBmdW5jdGlvbiAoSWYgaXQgcmV0dXJucyBmYWxzZSBleHBsaWNpdGVseSwgaXQgbWVhbnMgaXQgZG9udCB3YW50IHRvIG1vZGlmeSBhbnl0aW5nIG9uIHRoaXMgb2JqZWN0KVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5oYXNPd25Qcm9wZXJ0eShcInZhbHVlXCIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoZSByZWFsIG1vZGlmeWVyIGZ1bmN0aW9uIHJlcXVlc3RzIGEgZGVsZXRpb24gb2YgdGhlIG9iamVjdC4gSW5mb3JtIHRoZSBkZWxldGluZ0hvb2sgdGhhdCBhIGRlbGV0aW9uIGlzIHRha2luZyBwbGFjZS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRpbmdIb29rLmNhbGwodGhpcywgdGhpcy5wcmltS2V5LCBpdGVtLCB0cmFucyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gTm8gZGVsZXRpb24uIENoZWNrIHdoYXQgd2FzIGNoYW5nZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIG9iamVjdERpZmYgPSBnZXRPYmplY3REaWZmKG9yaWdJdGVtLCB0aGlzLnZhbHVlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGFkZGl0aW9uYWxDaGFuZ2VzID0gdXBkYXRpbmdIb29rLmNhbGwodGhpcywgb2JqZWN0RGlmZiwgdGhpcy5wcmltS2V5LCBvcmlnSXRlbSwgdHJhbnMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWRkaXRpb25hbENoYW5nZXMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEhvb2sgd2FudCB0byBhcHBseSBhZGRpdGlvbmFsIG1vZGlmaWNhdGlvbnMuIE1ha2Ugc3VyZSB0byBmdWxsZmlsbCB0aGUgd2lsbCBvZiB0aGUgaG9vay5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW0gPSB0aGlzLnZhbHVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXMoYWRkaXRpb25hbENoYW5nZXMpLmZvckVhY2goZnVuY3Rpb24gKGtleVBhdGgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXRCeUtleVBhdGgoaXRlbSwga2V5UGF0aCwgYWRkaXRpb25hbENoYW5nZXNba2V5UGF0aF0pOyAgLy8gQWRkaW5nIHtrZXlQYXRoOiB1bmRlZmluZWR9IG1lYW5zIHRoYXQgdGhlIGtleVBhdGggc2hvdWxkIGJlIGRlbGV0ZWQuIEhhbmRsZWQgYnkgc2V0QnlLZXlQYXRoXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh1cGRhdGluZ0hvb2sgPT09IG5vcCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBjaGFuZ2VzIGlzIGEgc2V0IG9mIHtrZXlQYXRoOiB2YWx1ZX0gYW5kIG5vIG9uZSBpcyBsaXN0ZW5pbmcgdG8gdGhlIHVwZGF0aW5nIGhvb2suXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBrZXlQYXRocyA9IE9iamVjdC5rZXlzKGNoYW5nZXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgbnVtS2V5cyA9IGtleVBhdGhzLmxlbmd0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbW9kaWZ5ZXIgPSBmdW5jdGlvbiAoaXRlbSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGFueXRoaW5nTW9kaWZpZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbnVtS2V5czsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGtleVBhdGggPSBrZXlQYXRoc1tpXSwgdmFsID0gY2hhbmdlc1trZXlQYXRoXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZ2V0QnlLZXlQYXRoKGl0ZW0sIGtleVBhdGgpICE9PSB2YWwpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0QnlLZXlQYXRoKGl0ZW0sIGtleVBhdGgsIHZhbCk7IC8vIEFkZGluZyB7a2V5UGF0aDogdW5kZWZpbmVkfSBtZWFucyB0aGF0IHRoZSBrZXlQYXRoIHNob3VsZCBiZSBkZWxldGVkLiBIYW5kbGVkIGJ5IHNldEJ5S2V5UGF0aFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbnl0aGluZ01vZGlmaWVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYW55dGhpbmdNb2RpZmllZDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTsgXHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gY2hhbmdlcyBpcyBhIHNldCBvZiB7a2V5UGF0aDogdmFsdWV9IGFuZCBwZW9wbGUgYXJlIGxpc3RlbmluZyB0byB0aGUgdXBkYXRpbmcgaG9vayBzbyB3ZSBuZWVkIHRvIGNhbGwgaXQgYW5kXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGFsbG93IGl0IHRvIGFkZCBhZGRpdGlvbmFsIG1vZGlmaWNhdGlvbnMgdG8gbWFrZS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIG9yaWdDaGFuZ2VzID0gY2hhbmdlcztcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlcyA9IHNoYWxsb3dDbG9uZShvcmlnQ2hhbmdlcyk7IC8vIExldCdzIHdvcmsgd2l0aCBhIGNsb25lIG9mIHRoZSBjaGFuZ2VzIGtleVBhdGgvdmFsdWUgc2V0IHNvIHRoYXQgd2UgY2FuIHJlc3RvcmUgaXQgaW4gY2FzZSBhIGhvb2sgZXh0ZW5kcyBpdC5cclxuICAgICAgICAgICAgICAgICAgICAgICAgbW9kaWZ5ZXIgPSBmdW5jdGlvbiAoaXRlbSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGFueXRoaW5nTW9kaWZpZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBhZGRpdGlvbmFsQ2hhbmdlcyA9IHVwZGF0aW5nSG9vay5jYWxsKHRoaXMsIGNoYW5nZXMsIHRoaXMucHJpbUtleSwgZGVlcENsb25lKGl0ZW0pLCB0cmFucyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWRkaXRpb25hbENoYW5nZXMpIGV4dGVuZChjaGFuZ2VzLCBhZGRpdGlvbmFsQ2hhbmdlcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhjaGFuZ2VzKS5mb3JFYWNoKGZ1bmN0aW9uIChrZXlQYXRoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHZhbCA9IGNoYW5nZXNba2V5UGF0aF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGdldEJ5S2V5UGF0aChpdGVtLCBrZXlQYXRoKSAhPT0gdmFsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldEJ5S2V5UGF0aChpdGVtLCBrZXlQYXRoLCB2YWwpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbnl0aGluZ01vZGlmaWVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhZGRpdGlvbmFsQ2hhbmdlcykgY2hhbmdlcyA9IHNoYWxsb3dDbG9uZShvcmlnQ2hhbmdlcyk7IC8vIFJlc3RvcmUgb3JpZ2luYWwgY2hhbmdlcyBmb3IgbmV4dCBpdGVyYXRpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhbnl0aGluZ01vZGlmaWVkO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9OyBcclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIHZhciBjb3VudCA9IDA7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHN1Y2Nlc3NDb3VudCA9IDA7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGl0ZXJhdGlvbkNvbXBsZXRlID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGZhaWx1cmVzID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGZhaWxLZXlzID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN1cnJlbnRLZXkgPSBudWxsO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICBmdW5jdGlvbiBtb2RpZnlJdGVtKGl0ZW0sIGN1cnNvciwgYWR2YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50S2V5ID0gY3Vyc29yLnByaW1hcnlLZXk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciB0aGlzQ29udGV4dCA9IHsgcHJpbUtleTogY3Vyc29yLnByaW1hcnlLZXksIHZhbHVlOiBpdGVtIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtb2RpZnllci5jYWxsKHRoaXNDb250ZXh0LCBpdGVtKSAhPT0gZmFsc2UpIHsgLy8gSWYgYSBjYWxsYmFjayBleHBsaWNpdGVseSByZXR1cm5zIGZhbHNlLCBkbyBub3QgcGVyZm9ybSB0aGUgdXBkYXRlIVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGJEZWxldGUgPSAhdGhpc0NvbnRleHQuaGFzT3duUHJvcGVydHkoXCJ2YWx1ZVwiKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciByZXEgPSAoYkRlbGV0ZSA/IGN1cnNvci5kZWxldGUoKSA6IGN1cnNvci51cGRhdGUodGhpc0NvbnRleHQudmFsdWUpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICsrY291bnQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXEub25lcnJvciA9IGV2ZW50UmVqZWN0SGFuZGxlcihmdW5jdGlvbiAoZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZhaWx1cmVzLnB1c2goZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZmFpbEtleXMucHVzaCh0aGlzQ29udGV4dC5wcmltS2V5KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpc0NvbnRleHQub25lcnJvcikgdGhpc0NvbnRleHQub25lcnJvcihlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGVja0ZpbmlzaGVkKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7IC8vIENhdGNoIHRoZXNlIGVycm9ycyBhbmQgbGV0IGEgZmluYWwgcmVqZWN0aW9uIGRlY2lkZSB3aGV0aGVyIG9yIG5vdCB0byBhYm9ydCBlbnRpcmUgdHJhbnNhY3Rpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sIGJEZWxldGUgPyBbXCJkZWxldGluZ1wiLCBpdGVtLCBcImZyb21cIiwgY3R4LnRhYmxlLm5hbWVdIDogW1wibW9kaWZ5aW5nXCIsIGl0ZW0sIFwib25cIiwgY3R4LnRhYmxlLm5hbWVdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpc0NvbnRleHQub25zdWNjZXNzKSB0aGlzQ29udGV4dC5vbnN1Y2Nlc3ModGhpc0NvbnRleHQudmFsdWUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICsrc3VjY2Vzc0NvdW50O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoZWNrRmluaXNoZWQoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXNDb250ZXh0Lm9uc3VjY2Vzcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gSG9vayB3aWxsIGV4cGVjdCBlaXRoZXIgb25lcnJvciBvciBvbnN1Y2Nlc3MgdG8gYWx3YXlzIGJlIGNhbGxlZCFcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXNDb250ZXh0Lm9uc3VjY2Vzcyh0aGlzQ29udGV4dC52YWx1ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uIGRvUmVqZWN0KGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZhaWx1cmVzLnB1c2goZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmYWlsS2V5cy5wdXNoKGN1cnJlbnRLZXkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiByZWplY3QobmV3IE1vZGlmeUVycm9yKFwiRXJyb3IgbW9kaWZ5aW5nIG9uZSBvciBtb3JlIG9iamVjdHNcIiwgZmFpbHVyZXMsIHN1Y2Nlc3NDb3VudCwgZmFpbEtleXMpKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uIGNoZWNrRmluaXNoZWQoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpdGVyYXRpb25Db21wbGV0ZSAmJiBzdWNjZXNzQ291bnQgKyBmYWlsdXJlcy5sZW5ndGggPT09IGNvdW50KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmFpbHVyZXMubGVuZ3RoID4gMClcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkb1JlamVjdCgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoc3VjY2Vzc0NvdW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBzZWxmLl9pdGVyYXRlKG1vZGlmeUl0ZW0sIGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaXRlcmF0aW9uQ29tcGxldGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGVja0ZpbmlzaGVkKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSwgZG9SZWplY3QsIGlkYnN0b3JlKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgJ2RlbGV0ZSc6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLm1vZGlmeShmdW5jdGlvbiAoKSB7IGRlbGV0ZSB0aGlzLnZhbHVlOyB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBIZWxwIGZ1bmN0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy9cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gbG93ZXJWZXJzaW9uRmlyc3QoYSwgYikge1xyXG4gICAgICAgICAgICByZXR1cm4gYS5fY2ZnLnZlcnNpb24gLSBiLl9jZmcudmVyc2lvbjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHNldEFwaU9uUGxhY2Uob2JqcywgdHJhbnNhY3Rpb25Qcm9taXNlRmFjdG9yeSwgdGFibGVOYW1lcywgbW9kZSwgZGJzY2hlbWEsIGVuYWJsZVByb2hpYml0ZWREQikge1xyXG4gICAgICAgICAgICB0YWJsZU5hbWVzLmZvckVhY2goZnVuY3Rpb24gKHRhYmxlTmFtZSkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHRhYmxlSW5zdGFuY2UgPSBkYi5fdGFibGVGYWN0b3J5KG1vZGUsIGRic2NoZW1hW3RhYmxlTmFtZV0sIHRyYW5zYWN0aW9uUHJvbWlzZUZhY3RvcnkpO1xyXG4gICAgICAgICAgICAgICAgb2Jqcy5mb3JFYWNoKGZ1bmN0aW9uIChvYmopIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIW9ialt0YWJsZU5hbWVdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlbmFibGVQcm9oaWJpdGVkREIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIHRhYmxlTmFtZSwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRcdFx0XHRcdFx0XHR2YXIgY3VycmVudFRyYW5zID0gUHJvbWlzZS5QU0QgJiYgUHJvbWlzZS5QU0QudHJhbnM7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50VHJhbnMgJiYgY3VycmVudFRyYW5zLmRiID09PSBkYikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRUcmFucy50YWJsZXNbdGFibGVOYW1lXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGFibGVJbnN0YW5jZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9ialt0YWJsZU5hbWVdID0gdGFibGVJbnN0YW5jZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHJlbW92ZVRhYmxlc0FwaShvYmpzKSB7XHJcbiAgICAgICAgICAgIG9ianMuZm9yRWFjaChmdW5jdGlvbiAob2JqKSB7XHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9ialtrZXldIGluc3RhbmNlb2YgVGFibGUpIGRlbGV0ZSBvYmpba2V5XTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBpdGVyYXRlKHJlcSwgZmlsdGVyLCBmbiwgcmVzb2x2ZSwgcmVqZWN0LCByZWFkaW5nSG9vaykge1xyXG4gICAgICAgICAgICB2YXIgcHNkID0gUHJvbWlzZS5QU0Q7XHJcbiAgICAgICAgICAgIHJlYWRpbmdIb29rID0gcmVhZGluZ0hvb2sgfHwgbWlycm9yO1xyXG4gICAgICAgICAgICBpZiAoIXJlcS5vbmVycm9yKSByZXEub25lcnJvciA9IGV2ZW50UmVqZWN0SGFuZGxlcihyZWplY3QpO1xyXG4gICAgICAgICAgICBpZiAoZmlsdGVyKSB7XHJcbiAgICAgICAgICAgICAgICByZXEub25zdWNjZXNzID0gdHJ5Y2F0Y2goZnVuY3Rpb24gZmlsdGVyX3JlY29yZChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN1cnNvciA9IHJlcS5yZXN1bHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnNvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgYyA9IGZ1bmN0aW9uICgpIHsgY3Vyc29yLmNvbnRpbnVlKCk7IH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmaWx0ZXIoY3Vyc29yLCBmdW5jdGlvbiAoYWR2YW5jZXIpIHsgYyA9IGFkdmFuY2VyOyB9LCByZXNvbHZlLCByZWplY3QpKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm4ocmVhZGluZ0hvb2soY3Vyc29yLnZhbHVlKSwgY3Vyc29yLCBmdW5jdGlvbiAoYWR2YW5jZXIpIHsgYyA9IGFkdmFuY2VyOyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYygpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9LCByZWplY3QsIHBzZCk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICByZXEub25zdWNjZXNzID0gdHJ5Y2F0Y2goZnVuY3Rpb24gZmlsdGVyX3JlY29yZChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN1cnNvciA9IHJlcS5yZXN1bHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGN1cnNvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgYyA9IGZ1bmN0aW9uICgpIHsgY3Vyc29yLmNvbnRpbnVlKCk7IH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZuKHJlYWRpbmdIb29rKGN1cnNvci52YWx1ZSksIGN1cnNvciwgZnVuY3Rpb24gKGFkdmFuY2VyKSB7IGMgPSBhZHZhbmNlcjsgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGMoKTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSwgcmVqZWN0LCBwc2QpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBwYXJzZUluZGV4U3ludGF4KGluZGV4ZXMpIHtcclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwiaW5kZXhlc1wiIHR5cGU9XCJTdHJpbmdcIj48L3BhcmFtPlxyXG4gICAgICAgICAgICAvLy8gPHJldHVybnMgdHlwZT1cIkFycmF5XCIgZWxlbWVudFR5cGU9XCJJbmRleFNwZWNcIj48L3JldHVybnM+XHJcbiAgICAgICAgICAgIHZhciBydiA9IFtdO1xyXG4gICAgICAgICAgICBpbmRleGVzLnNwbGl0KCcsJykuZm9yRWFjaChmdW5jdGlvbiAoaW5kZXgpIHtcclxuICAgICAgICAgICAgICAgIGluZGV4ID0gaW5kZXgudHJpbSgpO1xyXG4gICAgICAgICAgICAgICAgdmFyIG5hbWUgPSBpbmRleC5yZXBsYWNlKFwiJlwiLCBcIlwiKS5yZXBsYWNlKFwiKytcIiwgXCJcIikucmVwbGFjZShcIipcIiwgXCJcIik7XHJcbiAgICAgICAgICAgICAgICB2YXIga2V5UGF0aCA9IChuYW1lLmluZGV4T2YoJ1snKSAhPT0gMCA/IG5hbWUgOiBpbmRleC5zdWJzdHJpbmcoaW5kZXguaW5kZXhPZignWycpICsgMSwgaW5kZXguaW5kZXhPZignXScpKS5zcGxpdCgnKycpKTtcclxuXHJcbiAgICAgICAgICAgICAgICBydi5wdXNoKG5ldyBJbmRleFNwZWMoXHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICBrZXlQYXRoIHx8IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgaW5kZXguaW5kZXhPZignJicpICE9PSAtMSxcclxuICAgICAgICAgICAgICAgICAgICBpbmRleC5pbmRleE9mKCcqJykgIT09IC0xLFxyXG4gICAgICAgICAgICAgICAgICAgIGluZGV4LmluZGV4T2YoXCIrK1wiKSAhPT0gLTEsXHJcbiAgICAgICAgICAgICAgICAgICAgQXJyYXkuaXNBcnJheShrZXlQYXRoKSxcclxuICAgICAgICAgICAgICAgICAgICBrZXlQYXRoLmluZGV4T2YoJy4nKSAhPT0gLTFcclxuICAgICAgICAgICAgICAgICkpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmV0dXJuIHJ2O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gYXNjZW5kaW5nKGEsIGIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gZGVzY2VuZGluZyhhLCBiKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBhIDwgYiA/IDEgOiBhID4gYiA/IC0xIDogMDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIGNvbXBvdW5kQ29tcGFyZShpdGVtQ29tcGFyZSkge1xyXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGEsIGIpIHtcclxuICAgICAgICAgICAgICAgIHZhciBpID0gMDtcclxuICAgICAgICAgICAgICAgIHdoaWxlICh0cnVlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHJlc3VsdCA9IGl0ZW1Db21wYXJlKGFbaV0sIGJbaV0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChyZXN1bHQgIT09IDApIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgKytpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChpID09PSBhLmxlbmd0aCB8fCBpID09PSBiLmxlbmd0aClcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGl0ZW1Db21wYXJlKGEubGVuZ3RoLCBiLmxlbmd0aCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBjb21iaW5lKGZpbHRlcjEsIGZpbHRlcjIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGZpbHRlcjEgPyBmaWx0ZXIyID8gZnVuY3Rpb24gKCkgeyByZXR1cm4gZmlsdGVyMS5hcHBseSh0aGlzLCBhcmd1bWVudHMpICYmIGZpbHRlcjIuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSA6IGZpbHRlcjEgOiBmaWx0ZXIyO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gaGFzSUVEZWxldGVPYmplY3RTdG9yZUJ1ZygpIHtcclxuICAgICAgICAgICAgLy8gQXNzdW1lIGJ1ZyBpcyBwcmVzZW50IGluIElFMTAgYW5kIElFMTEgYnV0IGRvbnQgZXhwZWN0IGl0IGluIG5leHQgdmVyc2lvbiBvZiBJRSAoSUUxMilcclxuICAgICAgICAgICAgcmV0dXJuIG5hdmlnYXRvci51c2VyQWdlbnQuaW5kZXhPZihcIlRyaWRlbnRcIikgPj0gMCB8fCBuYXZpZ2F0b3IudXNlckFnZW50LmluZGV4T2YoXCJNU0lFXCIpID49IDA7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiByZWFkR2xvYmFsU2NoZW1hKCkge1xyXG4gICAgICAgICAgICBkYi52ZXJubyA9IGlkYmRiLnZlcnNpb24gLyAxMDtcclxuICAgICAgICAgICAgZGIuX2RiU2NoZW1hID0gZ2xvYmFsU2NoZW1hID0ge307XHJcbiAgICAgICAgICAgIGRiU3RvcmVOYW1lcyA9IFtdLnNsaWNlLmNhbGwoaWRiZGIub2JqZWN0U3RvcmVOYW1lcywgMCk7XHJcbiAgICAgICAgICAgIGlmIChkYlN0b3JlTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm47IC8vIERhdGFiYXNlIGNvbnRhaW5zIG5vIHN0b3Jlcy5cclxuICAgICAgICAgICAgdmFyIHRyYW5zID0gaWRiZGIudHJhbnNhY3Rpb24oc2FmYXJpTXVsdGlTdG9yZUZpeChkYlN0b3JlTmFtZXMpLCAncmVhZG9ubHknKTtcclxuICAgICAgICAgICAgZGJTdG9yZU5hbWVzLmZvckVhY2goZnVuY3Rpb24gKHN0b3JlTmFtZSkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHN0b3JlID0gdHJhbnMub2JqZWN0U3RvcmUoc3RvcmVOYW1lKSxcclxuICAgICAgICAgICAgICAgICAgICBrZXlQYXRoID0gc3RvcmUua2V5UGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBkb3R0ZWQgPSBrZXlQYXRoICYmIHR5cGVvZiBrZXlQYXRoID09PSAnc3RyaW5nJyAmJiBrZXlQYXRoLmluZGV4T2YoJy4nKSAhPT0gLTE7XHJcbiAgICAgICAgICAgICAgICB2YXIgcHJpbUtleSA9IG5ldyBJbmRleFNwZWMoa2V5UGF0aCwga2V5UGF0aCB8fCBcIlwiLCBmYWxzZSwgZmFsc2UsICEhc3RvcmUuYXV0b0luY3JlbWVudCwga2V5UGF0aCAmJiB0eXBlb2Yga2V5UGF0aCAhPT0gJ3N0cmluZycsIGRvdHRlZCk7XHJcbiAgICAgICAgICAgICAgICB2YXIgaW5kZXhlcyA9IFtdO1xyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBzdG9yZS5pbmRleE5hbWVzLmxlbmd0aDsgKytqKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGlkYmluZGV4ID0gc3RvcmUuaW5kZXgoc3RvcmUuaW5kZXhOYW1lc1tqXSk7XHJcbiAgICAgICAgICAgICAgICAgICAga2V5UGF0aCA9IGlkYmluZGV4LmtleVBhdGg7XHJcbiAgICAgICAgICAgICAgICAgICAgZG90dGVkID0ga2V5UGF0aCAmJiB0eXBlb2Yga2V5UGF0aCA9PT0gJ3N0cmluZycgJiYga2V5UGF0aC5pbmRleE9mKCcuJykgIT09IC0xO1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBpbmRleCA9IG5ldyBJbmRleFNwZWMoaWRiaW5kZXgubmFtZSwga2V5UGF0aCwgISFpZGJpbmRleC51bmlxdWUsICEhaWRiaW5kZXgubXVsdGlFbnRyeSwgZmFsc2UsIGtleVBhdGggJiYgdHlwZW9mIGtleVBhdGggIT09ICdzdHJpbmcnLCBkb3R0ZWQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGluZGV4ZXMucHVzaChpbmRleCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBnbG9iYWxTY2hlbWFbc3RvcmVOYW1lXSA9IG5ldyBUYWJsZVNjaGVtYShzdG9yZU5hbWUsIHByaW1LZXksIGluZGV4ZXMsIHt9KTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHNldEFwaU9uUGxhY2UoW2FsbFRhYmxlc10sIGRiLl90cmFuc1Byb21pc2VGYWN0b3J5LCBPYmplY3Qua2V5cyhnbG9iYWxTY2hlbWEpLCBSRUFEV1JJVEUsIGdsb2JhbFNjaGVtYSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBhZGp1c3RUb0V4aXN0aW5nSW5kZXhOYW1lcyhzY2hlbWEsIGlkYnRyYW5zKSB7XHJcbiAgICAgICAgICAgIC8vLyA8c3VtbWFyeT5cclxuICAgICAgICAgICAgLy8vIElzc3VlICMzMCBQcm9ibGVtIHdpdGggZXhpc3RpbmcgZGIgLSBhZGp1c3QgdG8gZXhpc3RpbmcgaW5kZXggbmFtZXMgd2hlbiBtaWdyYXRpbmcgZnJvbSBub24tZGV4aWUgZGJcclxuICAgICAgICAgICAgLy8vIDwvc3VtbWFyeT5cclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwic2NoZW1hXCIgdHlwZT1cIk9iamVjdFwiPk1hcCBiZXR3ZWVuIG5hbWUgYW5kIFRhYmxlU2NoZW1hPC9wYXJhbT5cclxuICAgICAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwiaWRidHJhbnNcIiB0eXBlPVwiSURCVHJhbnNhY3Rpb25cIj48L3BhcmFtPlxyXG4gICAgICAgICAgICB2YXIgc3RvcmVOYW1lcyA9IGlkYnRyYW5zLmRiLm9iamVjdFN0b3JlTmFtZXM7XHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RvcmVOYW1lcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgdmFyIHN0b3JlTmFtZSA9IHN0b3JlTmFtZXNbaV07XHJcbiAgICAgICAgICAgICAgICB2YXIgc3RvcmUgPSBpZGJ0cmFucy5vYmplY3RTdG9yZShzdG9yZU5hbWUpO1xyXG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBzdG9yZS5pbmRleE5hbWVzLmxlbmd0aDsgKytqKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGluZGV4TmFtZSA9IHN0b3JlLmluZGV4TmFtZXNbal07XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGtleVBhdGggPSBzdG9yZS5pbmRleChpbmRleE5hbWUpLmtleVBhdGg7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRleGllTmFtZSA9IHR5cGVvZiBrZXlQYXRoID09PSAnc3RyaW5nJyA/IGtleVBhdGggOiBcIltcIiArIFtdLnNsaWNlLmNhbGwoa2V5UGF0aCkuam9pbignKycpICsgXCJdXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNjaGVtYVtzdG9yZU5hbWVdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBpbmRleFNwZWMgPSBzY2hlbWFbc3RvcmVOYW1lXS5pZHhCeU5hbWVbZGV4aWVOYW1lXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluZGV4U3BlYykgaW5kZXhTcGVjLm5hbWUgPSBpbmRleE5hbWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBleHRlbmQodGhpcywge1xyXG4gICAgICAgICAgICBDb2xsZWN0aW9uOiBDb2xsZWN0aW9uLFxyXG4gICAgICAgICAgICBUYWJsZTogVGFibGUsXHJcbiAgICAgICAgICAgIFRyYW5zYWN0aW9uOiBUcmFuc2FjdGlvbixcclxuICAgICAgICAgICAgVmVyc2lvbjogVmVyc2lvbixcclxuICAgICAgICAgICAgV2hlcmVDbGF1c2U6IFdoZXJlQ2xhdXNlLFxyXG4gICAgICAgICAgICBXcml0ZWFibGVDb2xsZWN0aW9uOiBXcml0ZWFibGVDb2xsZWN0aW9uLFxyXG4gICAgICAgICAgICBXcml0ZWFibGVUYWJsZTogV3JpdGVhYmxlVGFibGVcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgaW5pdCgpO1xyXG5cclxuICAgICAgICBhZGRvbnMuZm9yRWFjaChmdW5jdGlvbiAoZm4pIHtcclxuICAgICAgICAgICAgZm4oZGIpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vXHJcbiAgICAvLyBQcm9taXNlIENsYXNzXHJcbiAgICAvL1xyXG4gICAgLy8gQSB2YXJpYW50IG9mIHByb21pc2UtbGlnaHQgKGh0dHBzOi8vZ2l0aHViLmNvbS90YXlsb3JoYWtlcy9wcm9taXNlLWxpZ2h0KSBieSBodHRwczovL2dpdGh1Yi5jb20vdGF5bG9yaGFrZXMgLSBhbiBBKyBhbmQgRUNNQVNDUklQVCA2IGNvbXBsaWFudCBQcm9taXNlIGltcGxlbWVudGF0aW9uLlxyXG4gICAgLy9cclxuICAgIC8vIE1vZGlmaWVkIGJ5IERhdmlkIEZhaGxhbmRlciB0byBiZSBpbmRleGVkREIgY29tcGxpYW50IChTZWUgZGlzY3Vzc2lvbjogaHR0cHM6Ly9naXRodWIuY29tL3Byb21pc2VzLWFwbHVzL3Byb21pc2VzLXNwZWMvaXNzdWVzLzQ1KSAuXHJcbiAgICAvLyBUaGlzIGltcGxlbWVudGF0aW9uIHdpbGwgbm90IHVzZSBzZXRUaW1lb3V0IG9yIHNldEltbWVkaWF0ZSB3aGVuIGl0J3Mgbm90IG5lZWRlZC4gVGhlIGJlaGF2aW9yIGlzIDEwMCUgUHJvbWlzZS9BKyBjb21wbGlhbnQgc2luY2VcclxuICAgIC8vIHRoZSBjYWxsZXIgb2YgbmV3IFByb21pc2UoKSBjYW4gYmUgY2VydGFpbiB0aGF0IHRoZSBwcm9taXNlIHdvbnQgYmUgdHJpZ2dlcmVkIHRoZSBsaW5lcyBhZnRlciBjb25zdHJ1Y3RpbmcgdGhlIHByb21pc2UuIFdlIGZpeCB0aGlzIGJ5IHVzaW5nIHRoZSBtZW1iZXIgdmFyaWFibGUgY29uc3RydWN0aW5nIHRvIGNoZWNrXHJcbiAgICAvLyB3aGV0aGVyIHRoZSBvYmplY3QgaXMgYmVpbmcgY29uc3RydWN0ZWQgd2hlbiByZWplY3Qgb3IgcmVzb2x2ZSBpcyBjYWxsZWQuIElmIHNvLCB0aGUgdXNlIHNldFRpbWVvdXQvc2V0SW1tZWRpYXRlIHRvIGZ1bGZpbGwgdGhlIHByb21pc2UsIG90aGVyd2lzZSwgd2Uga25vdyB0aGF0IGl0J3Mgbm90IG5lZWRlZC5cclxuICAgIC8vXHJcbiAgICAvLyBUaGlzIHRvcGljIHdhcyBhbHNvIGRpc2N1c3NlZCBpbiB0aGUgZm9sbG93aW5nIHRocmVhZDogaHR0cHM6Ly9naXRodWIuY29tL3Byb21pc2VzLWFwbHVzL3Byb21pc2VzLXNwZWMvaXNzdWVzLzQ1IGFuZCB0aGlzIGltcGxlbWVudGF0aW9uIHNvbHZlcyB0aGF0IGlzc3VlLlxyXG4gICAgLy9cclxuICAgIC8vIEFub3RoZXIgZmVhdHVyZSB3aXRoIHRoaXMgUHJvbWlzZSBpbXBsZW1lbnRhdGlvbiBpcyB0aGF0IHJlamVjdCB3aWxsIHJldHVybiBmYWxzZSBpbiBjYXNlIG5vIG9uZSBjYXRjaGVkIHRoZSByZWplY3QgY2FsbC4gVGhpcyBpcyB1c2VkXHJcbiAgICAvLyB0byBzdG9wUHJvcGFnYXRpb24oKSBvbiB0aGUgSURCUmVxdWVzdCBlcnJvciBldmVudCBpbiBjYXNlIGl0IHdhcyBjYXRjaGVkIGJ1dCBub3Qgb3RoZXJ3aXNlLlxyXG4gICAgLy9cclxuICAgIC8vIEFsc28sIHRoZSBldmVudCBuZXcgUHJvbWlzZSgpLm9udW5jYXRjaGVkIGlzIGNhbGxlZCBpbiBjYXNlIG5vIG9uZSBjYXRjaGVzIGEgcmVqZWN0IGNhbGwuIFRoaXMgaXMgdXNlZCBmb3IgdXMgdG8gbWFudWFsbHkgYnViYmxlIGFueSByZXF1ZXN0XHJcbiAgICAvLyBlcnJvcnMgdG8gdGhlIHRyYW5zYWN0aW9uLiBXZSBtdXN0IG5vdCByZWx5IG9uIEluZGV4ZWREQiBpbXBsZW1lbnRhdGlvbiB0byBkbyB0aGlzLCBiZWNhdXNlIGl0IG9ubHkgZG9lcyBzbyB3aGVuIHRoZSBzb3VyY2Ugb2YgdGhlIHJlamVjdGlvblxyXG4gICAgLy8gaXMgYW4gZXJyb3IgZXZlbnQgb24gYSByZXF1ZXN0LCBub3QgaW4gY2FzZSBhbiBvcmRpbmFyeSBleGNlcHRpb24gaXMgdGhyb3duLlxyXG4gICAgdmFyIFByb21pc2UgPSAoZnVuY3Rpb24gKCkge1xyXG5cclxuICAgICAgICAvLyBUaGUgdXNlIG9mIGFzYXAgaW4gaGFuZGxlKCkgaXMgcmVtYXJrZWQgYmVjYXVzZSB3ZSBtdXN0IE5PVCB1c2Ugc2V0VGltZW91dChmbiwwKSBiZWNhdXNlIGl0IGNhdXNlcyBwcmVtYXR1cmUgY29tbWl0IG9mIGluZGV4ZWREQiB0cmFuc2FjdGlvbnMgLSB3aGljaCBpcyBhY2NvcmRpbmcgdG8gaW5kZXhlZERCIHNwZWNpZmljYXRpb24uXHJcbiAgICAgICAgdmFyIF9zbGljZSA9IFtdLnNsaWNlO1xyXG4gICAgICAgIHZhciBfYXNhcCA9IHR5cGVvZiBzZXRJbW1lZGlhdGUgPT09ICd1bmRlZmluZWQnID8gZnVuY3Rpb24oZm4sIGFyZzEsIGFyZzIsIGFyZ04pIHtcclxuICAgICAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XHJcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IGZuLmFwcGx5KGdsb2JhbCwgX3NsaWNlLmNhbGwoYXJncywgMSkpOyB9LCAwKTsgLy8gSWYgbm90IEZGMTMgYW5kIGVhcmxpZXIgZmFpbGVkLCB3ZSBjb3VsZCB1c2UgdGhpcyBjYWxsIGhlcmUgaW5zdGVhZDogc2V0VGltZW91dC5jYWxsKHRoaXMsIFtmbiwgMF0uY29uY2F0KGFyZ3VtZW50cykpO1xyXG4gICAgICAgIH0gOiBzZXRJbW1lZGlhdGU7IC8vIElFMTArIGFuZCBub2RlLlxyXG5cclxuICAgICAgICBkb0Zha2VBdXRvQ29tcGxldGUoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAvLyBTaW1wbGlmeSB0aGUgam9iIGZvciBWUyBJbnRlbGxpc2Vuc2UuIFRoaXMgcGllY2Ugb2YgY29kZSBpcyBvbmUgb2YgdGhlIGtleXMgdG8gdGhlIG5ldyBtYXJ2ZWxsb3VzIGludGVsbGlzZW5zZSBzdXBwb3J0IGluIERleGllLlxyXG4gICAgICAgICAgICBfYXNhcCA9IGFzYXAgPSBlbnF1ZXVlSW1tZWRpYXRlID0gZnVuY3Rpb24oZm4pIHtcclxuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzOyBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyBmbi5hcHBseShnbG9iYWwsIF9zbGljZS5jYWxsKGFyZ3MsIDEpKTsgfSwgMCk7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHZhciBhc2FwID0gX2FzYXAsXHJcbiAgICAgICAgICAgIGlzUm9vdEV4ZWN1dGlvbiA9IHRydWU7XHJcblxyXG4gICAgICAgIHZhciBvcGVyYXRpb25zUXVldWUgPSBbXTtcclxuICAgICAgICB2YXIgdGlja0ZpbmFsaXplcnMgPSBbXTtcclxuICAgICAgICBmdW5jdGlvbiBlbnF1ZXVlSW1tZWRpYXRlKGZuLCBhcmdzKSB7XHJcbiAgICAgICAgICAgIG9wZXJhdGlvbnNRdWV1ZS5wdXNoKFtmbiwgX3NsaWNlLmNhbGwoYXJndW1lbnRzLCAxKV0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gZXhlY3V0ZU9wZXJhdGlvbnNRdWV1ZSgpIHtcclxuICAgICAgICAgICAgdmFyIHF1ZXVlID0gb3BlcmF0aW9uc1F1ZXVlO1xyXG4gICAgICAgICAgICBvcGVyYXRpb25zUXVldWUgPSBbXTtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBxdWV1ZS5sZW5ndGg7IGkgPCBsOyArK2kpIHtcclxuICAgICAgICAgICAgICAgIHZhciBpdGVtID0gcXVldWVbaV07XHJcbiAgICAgICAgICAgICAgICBpdGVtWzBdLmFwcGx5KGdsb2JhbCwgaXRlbVsxXSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vdmFyIFByb21pc2VJRCA9IDA7XHJcbiAgICAgICAgZnVuY3Rpb24gUHJvbWlzZShmbikge1xyXG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMgIT09ICdvYmplY3QnKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdQcm9taXNlcyBtdXN0IGJlIGNvbnN0cnVjdGVkIHZpYSBuZXcnKTtcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBmbiAhPT0gJ2Z1bmN0aW9uJykgdGhyb3cgbmV3IFR5cGVFcnJvcignbm90IGEgZnVuY3Rpb24nKTtcclxuICAgICAgICAgICAgdGhpcy5fc3RhdGUgPSBudWxsOyAvLyBudWxsICg9cGVuZGluZyksIGZhbHNlICg9cmVqZWN0ZWQpIG9yIHRydWUgKD1yZXNvbHZlZClcclxuICAgICAgICAgICAgdGhpcy5fdmFsdWUgPSBudWxsOyAvLyBlcnJvciBvciByZXN1bHRcclxuICAgICAgICAgICAgdGhpcy5fZGVmZXJyZWRzID0gW107XHJcbiAgICAgICAgICAgIHRoaXMuX2NhdGNoZWQgPSBmYWxzZTsgLy8gZm9yIG9udW5jYXRjaGVkXHJcbiAgICAgICAgICAgIC8vdGhpcy5faWQgPSArK1Byb21pc2VJRDtcclxuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gICAgICAgICAgICB2YXIgY29uc3RydWN0aW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhpcy5fUFNEID0gUHJvbWlzZS5QU0Q7XHJcblxyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgZG9SZXNvbHZlKHRoaXMsIGZuLCBmdW5jdGlvbiAoZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChjb25zdHJ1Y3RpbmcpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFzYXAocmVzb2x2ZSwgc2VsZiwgZGF0YSk7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHNlbGYsIGRhdGEpO1xyXG4gICAgICAgICAgICAgICAgfSwgZnVuY3Rpb24gKHJlYXNvbikge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChjb25zdHJ1Y3RpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXNhcChyZWplY3QsIHNlbGYsIHJlYXNvbik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVqZWN0KHNlbGYsIHJlYXNvbik7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gaGFuZGxlKHNlbGYsIGRlZmVycmVkKSB7XHJcbiAgICAgICAgICAgIGlmIChzZWxmLl9zdGF0ZSA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgc2VsZi5fZGVmZXJyZWRzLnB1c2goZGVmZXJyZWQpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB2YXIgY2IgPSBzZWxmLl9zdGF0ZSA/IGRlZmVycmVkLm9uRnVsZmlsbGVkIDogZGVmZXJyZWQub25SZWplY3RlZDtcclxuICAgICAgICAgICAgaWYgKGNiID09PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBUaGlzIERlZmVycmVkIGRvZXNudCBoYXZlIGEgbGlzdGVuZXIgZm9yIHRoZSBldmVudCBiZWluZyB0cmlnZ2VyZWQgKG9uRnVsZmlsbGVkIG9yIG9uUmVqZWN0KSBzbyBsZXRzIGZvcndhcmQgdGhlIGV2ZW50IHRvIGFueSBldmVudHVhbCBsaXN0ZW5lcnMgb24gdGhlIFByb21pc2UgaW5zdGFuY2UgcmV0dXJuZWQgYnkgdGhlbigpIG9yIGNhdGNoKClcclxuICAgICAgICAgICAgICAgIHJldHVybiAoc2VsZi5fc3RhdGUgPyBkZWZlcnJlZC5yZXNvbHZlIDogZGVmZXJyZWQucmVqZWN0KShzZWxmLl92YWx1ZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdmFyIHJldCwgaXNSb290RXhlYyA9IGlzUm9vdEV4ZWN1dGlvbjtcclxuICAgICAgICAgICAgaXNSb290RXhlY3V0aW9uID0gZmFsc2U7XHJcbiAgICAgICAgICAgIGFzYXAgPSBlbnF1ZXVlSW1tZWRpYXRlO1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgdmFyIG91dGVyUFNEID0gUHJvbWlzZS5QU0Q7XHJcbiAgICAgICAgICAgICAgICBQcm9taXNlLlBTRCA9IHNlbGYuX1BTRDtcclxuICAgICAgICAgICAgICAgIHJldCA9IGNiKHNlbGYuX3ZhbHVlKTtcclxuICAgICAgICAgICAgICAgIGlmICghc2VsZi5fc3RhdGUgJiYgKCFyZXQgfHwgdHlwZW9mIHJldC50aGVuICE9PSAnZnVuY3Rpb24nIHx8IHJldC5fc3RhdGUgIT09IGZhbHNlKSkgc2V0Q2F0Y2hlZChzZWxmKTsgLy8gQ2FsbGVyIGRpZCAncmV0dXJuIFByb21pc2UucmVqZWN0KGVycik7JyAtIGRvbid0IHJlZ2FyZCBpdCBhcyBjYXRjaGVkIVxyXG4gICAgICAgICAgICAgICAgZGVmZXJyZWQucmVzb2x2ZShyZXQpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgY2F0Y2hlZCA9IGRlZmVycmVkLnJlamVjdChlKTtcclxuICAgICAgICAgICAgICAgIGlmICghY2F0Y2hlZCAmJiBzZWxmLm9udW5jYXRjaGVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5vbnVuY2F0Y2hlZChlKTtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgICAgICAgICAgUHJvbWlzZS5QU0QgPSBvdXRlclBTRDtcclxuICAgICAgICAgICAgICAgIGlmIChpc1Jvb3RFeGVjKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZG8ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aGlsZSAob3BlcmF0aW9uc1F1ZXVlLmxlbmd0aCA+IDApIGV4ZWN1dGVPcGVyYXRpb25zUXVldWUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGZpbmFsaXplciA9IHRpY2tGaW5hbGl6ZXJzLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmluYWxpemVyKSB0cnkge2ZpbmFsaXplcigpO30gY2F0Y2goZSl7fVxyXG4gICAgICAgICAgICAgICAgICAgIH0gd2hpbGUgKHRpY2tGaW5hbGl6ZXJzLmxlbmd0aCA+IDAgfHwgb3BlcmF0aW9uc1F1ZXVlLmxlbmd0aCA+IDApO1xyXG4gICAgICAgICAgICAgICAgICAgIGFzYXAgPSBfYXNhcDtcclxuICAgICAgICAgICAgICAgICAgICBpc1Jvb3RFeGVjdXRpb24gPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBfcm9vdEV4ZWMoZm4pIHtcclxuICAgICAgICAgICAgdmFyIGlzUm9vdEV4ZWMgPSBpc1Jvb3RFeGVjdXRpb247XHJcbiAgICAgICAgICAgIGlzUm9vdEV4ZWN1dGlvbiA9IGZhbHNlO1xyXG4gICAgICAgICAgICBhc2FwID0gZW5xdWV1ZUltbWVkaWF0ZTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGZuKCk7XHJcbiAgICAgICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoaXNSb290RXhlYykge1xyXG4gICAgICAgICAgICAgICAgICAgIGRvIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgd2hpbGUgKG9wZXJhdGlvbnNRdWV1ZS5sZW5ndGggPiAwKSBleGVjdXRlT3BlcmF0aW9uc1F1ZXVlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBmaW5hbGl6ZXIgPSB0aWNrRmluYWxpemVycy5wb3AoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZpbmFsaXplcikgdHJ5IHsgZmluYWxpemVyKCk7IH0gY2F0Y2ggKGUpIHsgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gd2hpbGUgKHRpY2tGaW5hbGl6ZXJzLmxlbmd0aCA+IDAgfHwgb3BlcmF0aW9uc1F1ZXVlLmxlbmd0aCA+IDApO1xyXG4gICAgICAgICAgICAgICAgICAgIGFzYXAgPSBfYXNhcDtcclxuICAgICAgICAgICAgICAgICAgICBpc1Jvb3RFeGVjdXRpb24gPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBzZXRDYXRjaGVkKHByb21pc2UpIHtcclxuICAgICAgICAgICAgcHJvbWlzZS5fY2F0Y2hlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIGlmIChwcm9taXNlLl9wYXJlbnQpIHNldENhdGNoZWQocHJvbWlzZS5fcGFyZW50KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHJlc29sdmUocHJvbWlzZSwgbmV3VmFsdWUpIHtcclxuICAgICAgICAgICAgdmFyIG91dGVyUFNEID0gUHJvbWlzZS5QU0Q7XHJcbiAgICAgICAgICAgIFByb21pc2UuUFNEID0gcHJvbWlzZS5fUFNEO1xyXG4gICAgICAgICAgICB0cnkgeyAvL1Byb21pc2UgUmVzb2x1dGlvbiBQcm9jZWR1cmU6IGh0dHBzOi8vZ2l0aHViLmNvbS9wcm9taXNlcy1hcGx1cy9wcm9taXNlcy1zcGVjI3RoZS1wcm9taXNlLXJlc29sdXRpb24tcHJvY2VkdXJlXHJcbiAgICAgICAgICAgICAgICBpZiAobmV3VmFsdWUgPT09IHByb21pc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgcHJvbWlzZSBjYW5ub3QgYmUgcmVzb2x2ZWQgd2l0aCBpdHNlbGYuJyk7XHJcbiAgICAgICAgICAgICAgICBpZiAobmV3VmFsdWUgJiYgKHR5cGVvZiBuZXdWYWx1ZSA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIG5ld1ZhbHVlID09PSAnZnVuY3Rpb24nKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgbmV3VmFsdWUudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkb1Jlc29sdmUocHJvbWlzZSwgZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy9uZXdWYWx1ZSBpbnN0YW5jZW9mIFByb21pc2UgPyBuZXdWYWx1ZS5fdGhlbihyZXNvbHZlLCByZWplY3QpIDogbmV3VmFsdWUudGhlbihyZXNvbHZlLCByZWplY3QpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3VmFsdWUudGhlbihyZXNvbHZlLCByZWplY3QpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LCBmdW5jdGlvbiAoZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShwcm9taXNlLCBkYXRhKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSwgZnVuY3Rpb24gKHJlYXNvbikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KHByb21pc2UsIHJlYXNvbik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgcHJvbWlzZS5fc3RhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgcHJvbWlzZS5fdmFsdWUgPSBuZXdWYWx1ZTtcclxuICAgICAgICAgICAgICAgIGZpbmFsZS5jYWxsKHByb21pc2UpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgICAgIFByb21pc2UuUFNEID0gb3V0ZXJQU0Q7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHJlamVjdChwcm9taXNlLCBuZXdWYWx1ZSkge1xyXG4gICAgICAgICAgICB2YXIgb3V0ZXJQU0QgPSBQcm9taXNlLlBTRDtcclxuICAgICAgICAgICAgUHJvbWlzZS5QU0QgPSBwcm9taXNlLl9QU0Q7XHJcbiAgICAgICAgICAgIHByb21pc2UuX3N0YXRlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHByb21pc2UuX3ZhbHVlID0gbmV3VmFsdWU7XHJcblxyXG4gICAgICAgICAgICBmaW5hbGUuY2FsbChwcm9taXNlKTtcclxuICAgICAgICAgICAgaWYgKCFwcm9taXNlLl9jYXRjaGVkKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChwcm9taXNlLm9udW5jYXRjaGVkKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9taXNlLm9udW5jYXRjaGVkKHByb21pc2UuX3ZhbHVlKTtcclxuICAgICAgICAgICAgICAgICAgICBQcm9taXNlLm9uLmVycm9yLmZpcmUocHJvbWlzZS5fdmFsdWUpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFByb21pc2UuUFNEID0gb3V0ZXJQU0Q7XHJcbiAgICAgICAgICAgIHJldHVybiBwcm9taXNlLl9jYXRjaGVkO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gZmluYWxlKCkge1xyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gdGhpcy5fZGVmZXJyZWRzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICBoYW5kbGUodGhpcywgdGhpcy5fZGVmZXJyZWRzW2ldKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLl9kZWZlcnJlZHMgPSBbXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIERlZmVycmVkKG9uRnVsZmlsbGVkLCBvblJlamVjdGVkLCByZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgdGhpcy5vbkZ1bGZpbGxlZCA9IHR5cGVvZiBvbkZ1bGZpbGxlZCA9PT0gJ2Z1bmN0aW9uJyA/IG9uRnVsZmlsbGVkIDogbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5vblJlamVjdGVkID0gdHlwZW9mIG9uUmVqZWN0ZWQgPT09ICdmdW5jdGlvbicgPyBvblJlamVjdGVkIDogbnVsbDtcclxuICAgICAgICAgICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcclxuICAgICAgICAgICAgdGhpcy5yZWplY3QgPSByZWplY3Q7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKiBUYWtlIGEgcG90ZW50aWFsbHkgbWlzYmVoYXZpbmcgcmVzb2x2ZXIgZnVuY3Rpb24gYW5kIG1ha2Ugc3VyZVxyXG4gICAgICAgICAqIG9uRnVsZmlsbGVkIGFuZCBvblJlamVjdGVkIGFyZSBvbmx5IGNhbGxlZCBvbmNlLlxyXG4gICAgICAgICAqXHJcbiAgICAgICAgICogTWFrZXMgbm8gZ3VhcmFudGVlcyBhYm91dCBhc3luY2hyb255LlxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIGZ1bmN0aW9uIGRvUmVzb2x2ZShwcm9taXNlLCBmbiwgb25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpIHtcclxuICAgICAgICAgICAgdmFyIGRvbmUgPSBmYWxzZTtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGZuKGZ1bmN0aW9uIFByb21pc2VfcmVzb2x2ZSh2YWx1ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChkb25lKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgZG9uZSA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgb25GdWxmaWxsZWQodmFsdWUpO1xyXG4gICAgICAgICAgICAgICAgfSwgZnVuY3Rpb24gUHJvbWlzZV9yZWplY3QocmVhc29uKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRvbmUpIHJldHVybiBwcm9taXNlLl9jYXRjaGVkO1xyXG4gICAgICAgICAgICAgICAgICAgIGRvbmUgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBvblJlamVjdGVkKHJlYXNvbik7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXgpIHtcclxuICAgICAgICAgICAgICAgIGlmIChkb25lKSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gb25SZWplY3RlZChleCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIFByb21pc2Uub24gPSBldmVudHMobnVsbCwgXCJlcnJvclwiKTtcclxuXHJcbiAgICAgICAgUHJvbWlzZS5hbGwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSAmJiBBcnJheS5pc0FycmF5KGFyZ3VtZW50c1swXSkgPyBhcmd1bWVudHNbMF0gOiBhcmd1bWVudHMpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgICAgIGlmIChhcmdzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHJlc29sdmUoW10pO1xyXG4gICAgICAgICAgICAgICAgdmFyIHJlbWFpbmluZyA9IGFyZ3MubGVuZ3RoO1xyXG4gICAgICAgICAgICAgICAgZnVuY3Rpb24gcmVzKGksIHZhbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh2YWwgJiYgKHR5cGVvZiB2YWwgPT09ICdvYmplY3QnIHx8IHR5cGVvZiB2YWwgPT09ICdmdW5jdGlvbicpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgdGhlbiA9IHZhbC50aGVuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGVuID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhlbi5jYWxsKHZhbCwgZnVuY3Rpb24gKHZhbCkgeyByZXMoaSwgdmFsKTsgfSwgcmVqZWN0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgYXJnc1tpXSA9IHZhbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKC0tcmVtYWluaW5nID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKGFyZ3MpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGV4KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgICAgICAgICByZXMoaSwgYXJnc1tpXSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8qIFByb3RvdHlwZSBNZXRob2RzICovXHJcbiAgICAgICAgUHJvbWlzZS5wcm90b3R5cGUudGhlbiA9IGZ1bmN0aW9uIChvbkZ1bGZpbGxlZCwgb25SZWplY3RlZCkge1xyXG4gICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XHJcbiAgICAgICAgICAgIHZhciBwID0gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHNlbGYuX3N0YXRlID09PSBudWxsKVxyXG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZShzZWxmLCBuZXcgRGVmZXJyZWQob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQsIHJlc29sdmUsIHJlamVjdCkpO1xyXG4gICAgICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgICAgIGFzYXAoaGFuZGxlLCBzZWxmLCBuZXcgRGVmZXJyZWQob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQsIHJlc29sdmUsIHJlamVjdCkpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcC5fUFNEID0gdGhpcy5fUFNEO1xyXG4gICAgICAgICAgICBwLm9udW5jYXRjaGVkID0gdGhpcy5vbnVuY2F0Y2hlZDsgLy8gTmVlZGVkIHdoZW4gZXhjZXB0aW9uIG9jY3VycyBpbiBhIHRoZW4oKSBjbGF1c2Ugb2YgYSBzdWNjZXNzZnVsIHBhcmVudCBwcm9taXNlLiBXYW50IG9udW5jYXRjaGVkIHRvIGJlIGNhbGxlZCBldmVuIGluIGNhbGxiYWNrcyBvZiBjYWxsYmFja3Mgb2YgdGhlIG9yaWdpbmFsIHByb21pc2UuXHJcbiAgICAgICAgICAgIHAuX3BhcmVudCA9IHRoaXM7IC8vIFVzZWQgZm9yIHJlY3Vyc2l2ZWx5IGNhbGxpbmcgb251bmNhdGNoZWQgZXZlbnQgb24gc2VsZiBhbmQgYWxsIHBhcmVudHMuXHJcbiAgICAgICAgICAgIHJldHVybiBwO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIFByb21pc2UucHJvdG90eXBlLl90aGVuID0gZnVuY3Rpb24gKG9uRnVsZmlsbGVkLCBvblJlamVjdGVkKSB7XHJcbiAgICAgICAgICAgIGhhbmRsZSh0aGlzLCBuZXcgRGVmZXJyZWQob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQsIG5vcCxub3ApKTtcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBQcm9taXNlLnByb3RvdHlwZVsnY2F0Y2gnXSA9IGZ1bmN0aW9uIChvblJlamVjdGVkKSB7XHJcbiAgICAgICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAxKSByZXR1cm4gdGhpcy50aGVuKG51bGwsIG9uUmVqZWN0ZWQpO1xyXG4gICAgICAgICAgICAvLyBGaXJzdCBhcmd1bWVudCBpcyB0aGUgRXJyb3IgdHlwZSB0byBjYXRjaFxyXG4gICAgICAgICAgICB2YXIgdHlwZSA9IGFyZ3VtZW50c1swXSwgY2FsbGJhY2sgPSBhcmd1bWVudHNbMV07XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdHlwZSA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHRoaXMudGhlbihudWxsLCBmdW5jdGlvbiAoZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gQ2F0Y2hpbmcgZXJyb3JzIGJ5IGl0cyBjb25zdHJ1Y3RvciB0eXBlIChzaW1pbGFyIHRvIGphdmEgLyBjKysgLyBjIylcclxuICAgICAgICAgICAgICAgIC8vIFNhbXBsZTogcHJvbWlzZS5jYXRjaChUeXBlRXJyb3IsIGZ1bmN0aW9uIChlKSB7IC4uLiB9KTtcclxuICAgICAgICAgICAgICAgIGlmIChlIGluc3RhbmNlb2YgdHlwZSkgcmV0dXJuIGNhbGxiYWNrKGUpOyBlbHNlIHJldHVybiBQcm9taXNlLnJlamVjdChlKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIGVsc2UgcmV0dXJuIHRoaXMudGhlbihudWxsLCBmdW5jdGlvbiAoZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gQ2F0Y2hpbmcgZXJyb3JzIGJ5IHRoZSBlcnJvci5uYW1lIHByb3BlcnR5LiBNYWtlcyBzZW5zZSBmb3IgaW5kZXhlZERCIHdoZXJlIGVycm9yIHR5cGVcclxuICAgICAgICAgICAgICAgIC8vIGlzIGFsd2F5cyBET01FcnJvciBidXQgd2hlcmUgZS5uYW1lIHRlbGxzIHRoZSBhY3R1YWwgZXJyb3IgdHlwZS5cclxuICAgICAgICAgICAgICAgIC8vIFNhbXBsZTogcHJvbWlzZS5jYXRjaCgnQ29uc3RyYWludEVycm9yJywgZnVuY3Rpb24gKGUpIHsgLi4uIH0pO1xyXG4gICAgICAgICAgICAgICAgaWYgKGUgJiYgZS5uYW1lID09PSB0eXBlKSByZXR1cm4gY2FsbGJhY2soZSk7IGVsc2UgcmV0dXJuIFByb21pc2UucmVqZWN0KGUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBQcm9taXNlLnByb3RvdHlwZVsnZmluYWxseSddID0gZnVuY3Rpb24gKG9uRmluYWxseSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy50aGVuKGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gICAgICAgICAgICAgICAgb25GaW5hbGx5KCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWU7XHJcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcclxuICAgICAgICAgICAgICAgIG9uRmluYWxseSgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KGVycik7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIFByb21pc2UucHJvdG90eXBlLm9udW5jYXRjaGVkID0gbnVsbDsgLy8gT3B0aW9uYWwgZXZlbnQgdHJpZ2dlcmVkIGlmIHByb21pc2UgaXMgcmVqZWN0ZWQgYnV0IG5vIG9uZSBsaXN0ZW5lZC5cclxuXHJcbiAgICAgICAgUHJvbWlzZS5yZXNvbHZlID0gZnVuY3Rpb24gKHZhbHVlKSB7XHJcbiAgICAgICAgICAgIHZhciBwID0gbmV3IFByb21pc2UoZnVuY3Rpb24gKCkgeyB9KTtcclxuICAgICAgICAgICAgcC5fc3RhdGUgPSB0cnVlO1xyXG4gICAgICAgICAgICBwLl92YWx1ZSA9IHZhbHVlO1xyXG4gICAgICAgICAgICByZXR1cm4gcDtcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBQcm9taXNlLnJlamVjdCA9IGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gICAgICAgICAgICB2YXIgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uICgpIHsgfSk7XHJcbiAgICAgICAgICAgIHAuX3N0YXRlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIHAuX3ZhbHVlID0gdmFsdWU7XHJcbiAgICAgICAgICAgIHJldHVybiBwO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIFByb21pc2UucmFjZSA9IGZ1bmN0aW9uICh2YWx1ZXMpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgICAgIHZhbHVlcy5tYXAoZnVuY3Rpb24gKHZhbHVlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUudGhlbihyZXNvbHZlLCByZWplY3QpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIFByb21pc2UuUFNEID0gbnVsbDsgLy8gUHJvbWlzZSBTcGVjaWZpYyBEYXRhIC0gYSBUTFMgUGF0dGVybiAoVGhyZWFkIExvY2FsIFN0b3JhZ2UpIGZvciBQcm9taXNlcy4gVE9ETzogUmVuYW1lIFByb21pc2UuUFNEIHRvIFByb21pc2UuZGF0YVxyXG5cclxuICAgICAgICBQcm9taXNlLm5ld1BTRCA9IGZ1bmN0aW9uIChmbikge1xyXG4gICAgICAgICAgICAvLyBDcmVhdGUgbmV3IFBTRCBzY29wZSAoUHJvbWlzZSBTcGVjaWZpYyBEYXRhKVxyXG4gICAgICAgICAgICB2YXIgb3V0ZXJTY29wZSA9IFByb21pc2UuUFNEO1xyXG4gICAgICAgICAgICBQcm9taXNlLlBTRCA9IG91dGVyU2NvcGUgPyBPYmplY3QuY3JlYXRlKG91dGVyU2NvcGUpIDoge307XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gZm4oKTtcclxuICAgICAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgICAgIFByb21pc2UuUFNEID0gb3V0ZXJTY29wZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIFByb21pc2UuX3Jvb3RFeGVjID0gX3Jvb3RFeGVjO1xyXG4gICAgICAgIFByb21pc2UuX3RpY2tGaW5hbGl6ZSA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XHJcbiAgICAgICAgICAgIGlmIChpc1Jvb3RFeGVjdXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vdCBpbiBhIHZpcnR1YWwgdGlja1wiKTtcclxuICAgICAgICAgICAgdGlja0ZpbmFsaXplcnMucHVzaChjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgcmV0dXJuIFByb21pc2U7XHJcbiAgICB9KSgpO1xyXG5cclxuXHJcbiAgICAvL1xyXG4gICAgLy9cclxuICAgIC8vIC0tLS0tLSBFeHBvcnRhYmxlIEhlbHAgRnVuY3Rpb25zIC0tLS0tLS1cclxuICAgIC8vXHJcbiAgICAvL1xyXG5cclxuICAgIGZ1bmN0aW9uIG5vcCgpIHsgfVxyXG4gICAgZnVuY3Rpb24gbWlycm9yKHZhbCkgeyByZXR1cm4gdmFsOyB9XHJcblxyXG4gICAgZnVuY3Rpb24gcHVyZUZ1bmN0aW9uQ2hhaW4oZjEsIGYyKSB7XHJcbiAgICAgICAgLy8gRW5hYmxlcyBjaGFpbmVkIGV2ZW50cyB0aGF0IHRha2VzIE9ORSBhcmd1bWVudCBhbmQgcmV0dXJucyBpdCB0byB0aGUgbmV4dCBmdW5jdGlvbiBpbiBjaGFpbi5cclxuICAgICAgICAvLyBUaGlzIHBhdHRlcm4gaXMgdXNlZCBpbiB0aGUgaG9vayhcInJlYWRpbmdcIikgZXZlbnQuXHJcbiAgICAgICAgaWYgKGYxID09PSBtaXJyb3IpIHJldHVybiBmMjtcclxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKHZhbCkge1xyXG4gICAgICAgICAgICByZXR1cm4gZjIoZjEodmFsKSk7XHJcbiAgICAgICAgfTsgXHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gY2FsbEJvdGgob24xLCBvbjIpIHtcclxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICBvbjEuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcclxuICAgICAgICAgICAgb24yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XHJcbiAgICAgICAgfTsgXHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gaG9va0NyZWF0aW5nQ2hhaW4oZjEsIGYyKSB7XHJcbiAgICAgICAgLy8gRW5hYmxlcyBjaGFpbmVkIGV2ZW50cyB0aGF0IHRha2VzIHNldmVyYWwgYXJndW1lbnRzIGFuZCBtYXkgbW9kaWZ5IGZpcnN0IGFyZ3VtZW50IGJ5IG1ha2luZyBhIG1vZGlmaWNhdGlvbiBhbmQgdGhlbiByZXR1cm5pbmcgdGhlIHNhbWUgaW5zdGFuY2UuXHJcbiAgICAgICAgLy8gVGhpcyBwYXR0ZXJuIGlzIHVzZWQgaW4gdGhlIGhvb2soXCJjcmVhdGluZ1wiKSBldmVudC5cclxuICAgICAgICBpZiAoZjEgPT09IG5vcCkgcmV0dXJuIGYyO1xyXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHZhciByZXMgPSBmMS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG4gICAgICAgICAgICBpZiAocmVzICE9PSB1bmRlZmluZWQpIGFyZ3VtZW50c1swXSA9IHJlcztcclxuICAgICAgICAgICAgdmFyIG9uc3VjY2VzcyA9IHRoaXMub25zdWNjZXNzLCAvLyBJbiBjYXNlIGV2ZW50IGxpc3RlbmVyIGhhcyBzZXQgdGhpcy5vbnN1Y2Nlc3NcclxuICAgICAgICAgICAgICAgIG9uZXJyb3IgPSB0aGlzLm9uZXJyb3I7ICAgICAvLyBJbiBjYXNlIGV2ZW50IGxpc3RlbmVyIGhhcyBzZXQgdGhpcy5vbmVycm9yXHJcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLm9uc3VjY2VzcztcclxuICAgICAgICAgICAgZGVsZXRlIHRoaXMub25lcnJvcjtcclxuICAgICAgICAgICAgdmFyIHJlczIgPSBmMi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG4gICAgICAgICAgICBpZiAob25zdWNjZXNzKSB0aGlzLm9uc3VjY2VzcyA9IHRoaXMub25zdWNjZXNzID8gY2FsbEJvdGgob25zdWNjZXNzLCB0aGlzLm9uc3VjY2VzcykgOiBvbnN1Y2Nlc3M7XHJcbiAgICAgICAgICAgIGlmIChvbmVycm9yKSB0aGlzLm9uZXJyb3IgPSB0aGlzLm9uZXJyb3IgPyBjYWxsQm90aChvbmVycm9yLCB0aGlzLm9uZXJyb3IpIDogb25lcnJvcjtcclxuICAgICAgICAgICAgcmV0dXJuIHJlczIgIT09IHVuZGVmaW5lZCA/IHJlczIgOiByZXM7XHJcbiAgICAgICAgfTsgXHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gaG9va1VwZGF0aW5nQ2hhaW4oZjEsIGYyKSB7XHJcbiAgICAgICAgaWYgKGYxID09PSBub3ApIHJldHVybiBmMjtcclxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICB2YXIgcmVzID0gZjEuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcclxuICAgICAgICAgICAgaWYgKHJlcyAhPT0gdW5kZWZpbmVkKSBleHRlbmQoYXJndW1lbnRzWzBdLCByZXMpOyAvLyBJZiBmMSByZXR1cm5zIG5ldyBtb2RpZmljYXRpb25zLCBleHRlbmQgY2FsbGVyJ3MgbW9kaWZpY2F0aW9ucyB3aXRoIHRoZSByZXN1bHQgYmVmb3JlIGNhbGxpbmcgbmV4dCBpbiBjaGFpbi5cclxuICAgICAgICAgICAgdmFyIG9uc3VjY2VzcyA9IHRoaXMub25zdWNjZXNzLCAvLyBJbiBjYXNlIGV2ZW50IGxpc3RlbmVyIGhhcyBzZXQgdGhpcy5vbnN1Y2Nlc3NcclxuICAgICAgICAgICAgICAgIG9uZXJyb3IgPSB0aGlzLm9uZXJyb3I7ICAgICAvLyBJbiBjYXNlIGV2ZW50IGxpc3RlbmVyIGhhcyBzZXQgdGhpcy5vbmVycm9yXHJcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLm9uc3VjY2VzcztcclxuICAgICAgICAgICAgZGVsZXRlIHRoaXMub25lcnJvcjtcclxuICAgICAgICAgICAgdmFyIHJlczIgPSBmMi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG4gICAgICAgICAgICBpZiAob25zdWNjZXNzKSB0aGlzLm9uc3VjY2VzcyA9IHRoaXMub25zdWNjZXNzID8gY2FsbEJvdGgob25zdWNjZXNzLCB0aGlzLm9uc3VjY2VzcykgOiBvbnN1Y2Nlc3M7XHJcbiAgICAgICAgICAgIGlmIChvbmVycm9yKSB0aGlzLm9uZXJyb3IgPSB0aGlzLm9uZXJyb3IgPyBjYWxsQm90aChvbmVycm9yLCB0aGlzLm9uZXJyb3IpIDogb25lcnJvcjtcclxuICAgICAgICAgICAgcmV0dXJuIHJlcyA9PT0gdW5kZWZpbmVkID9cclxuICAgICAgICAgICAgICAgIChyZXMyID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiByZXMyKSA6XHJcbiAgICAgICAgICAgICAgICAocmVzMiA9PT0gdW5kZWZpbmVkID8gcmVzIDogZXh0ZW5kKHJlcywgcmVzMikpO1xyXG4gICAgICAgIH07IFxyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHN0b3BwYWJsZUV2ZW50Q2hhaW4oZjEsIGYyKSB7XHJcbiAgICAgICAgLy8gRW5hYmxlcyBjaGFpbmVkIGV2ZW50cyB0aGF0IG1heSByZXR1cm4gZmFsc2UgdG8gc3RvcCB0aGUgZXZlbnQgY2hhaW4uXHJcbiAgICAgICAgaWYgKGYxID09PSBub3ApIHJldHVybiBmMjtcclxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICBpZiAoZjEuYXBwbHkodGhpcywgYXJndW1lbnRzKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgcmV0dXJuIGYyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XHJcbiAgICAgICAgfTsgXHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gcmV2ZXJzZVN0b3BwYWJsZUV2ZW50Q2hhaW4oZjEsIGYyKSB7XHJcbiAgICAgICAgaWYgKGYxID09PSBub3ApIHJldHVybiBmMjtcclxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICBpZiAoZjIuYXBwbHkodGhpcywgYXJndW1lbnRzKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgcmV0dXJuIGYxLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XHJcbiAgICAgICAgfTsgXHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gbm9uU3RvcHBhYmxlRXZlbnRDaGFpbihmMSwgZjIpIHtcclxuICAgICAgICBpZiAoZjEgPT09IG5vcCkgcmV0dXJuIGYyO1xyXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGYxLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XHJcbiAgICAgICAgICAgIGYyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XHJcbiAgICAgICAgfTsgXHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gcHJvbWlzYWJsZUNoYWluKGYxLCBmMikge1xyXG4gICAgICAgIGlmIChmMSA9PT0gbm9wKSByZXR1cm4gZjI7XHJcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgdmFyIHJlcyA9IGYxLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XHJcbiAgICAgICAgICAgIGlmIChyZXMgJiYgdHlwZW9mIHJlcy50aGVuID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgdGhpeiA9IHRoaXMsIGFyZ3MgPSBhcmd1bWVudHM7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzLnRoZW4oZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmMi5hcHBseSh0aGl6LCBhcmdzKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBmMi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG4gICAgICAgIH07IFxyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIGV2ZW50cyhjdHgsIGV2ZW50TmFtZXMpIHtcclxuICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcclxuICAgICAgICB2YXIgZXZzID0ge307XHJcbiAgICAgICAgdmFyIHJ2ID0gZnVuY3Rpb24gKGV2ZW50TmFtZSwgc3Vic2NyaWJlcikge1xyXG4gICAgICAgICAgICBpZiAoc3Vic2NyaWJlcikge1xyXG4gICAgICAgICAgICAgICAgLy8gU3Vic2NyaWJlXHJcbiAgICAgICAgICAgICAgICB2YXIgYXJncyA9IFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcclxuICAgICAgICAgICAgICAgIHZhciBldiA9IGV2c1tldmVudE5hbWVdO1xyXG4gICAgICAgICAgICAgICAgZXYuc3Vic2NyaWJlLmFwcGx5KGV2LCBhcmdzKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBjdHg7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIChldmVudE5hbWUpID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICAgICAgLy8gUmV0dXJuIGludGVyZmFjZSBhbGxvd2luZyB0byBmaXJlIG9yIHVuc3Vic2NyaWJlIGZyb20gZXZlbnRcclxuICAgICAgICAgICAgICAgIHJldHVybiBldnNbZXZlbnROYW1lXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07IFxyXG4gICAgICAgIHJ2LmFkZEV2ZW50VHlwZSA9IGFkZDtcclxuXHJcbiAgICAgICAgZnVuY3Rpb24gYWRkKGV2ZW50TmFtZSwgY2hhaW5GdW5jdGlvbiwgZGVmYXVsdEZ1bmN0aW9uKSB7XHJcbiAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGV2ZW50TmFtZSkpIHJldHVybiBhZGRFdmVudEdyb3VwKGV2ZW50TmFtZSk7XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2YgZXZlbnROYW1lID09PSAnb2JqZWN0JykgcmV0dXJuIGFkZENvbmZpZ3VyZWRFdmVudHMoZXZlbnROYW1lKTtcclxuICAgICAgICAgICAgaWYgKCFjaGFpbkZ1bmN0aW9uKSBjaGFpbkZ1bmN0aW9uID0gc3RvcHBhYmxlRXZlbnRDaGFpbjtcclxuICAgICAgICAgICAgaWYgKCFkZWZhdWx0RnVuY3Rpb24pIGRlZmF1bHRGdW5jdGlvbiA9IG5vcDtcclxuXHJcbiAgICAgICAgICAgIHZhciBjb250ZXh0ID0ge1xyXG4gICAgICAgICAgICAgICAgc3Vic2NyaWJlcnM6IFtdLFxyXG4gICAgICAgICAgICAgICAgZmlyZTogZGVmYXVsdEZ1bmN0aW9uLFxyXG4gICAgICAgICAgICAgICAgc3Vic2NyaWJlOiBmdW5jdGlvbiAoY2IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb250ZXh0LnN1YnNjcmliZXJzLnB1c2goY2IpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRleHQuZmlyZSA9IGNoYWluRnVuY3Rpb24oY29udGV4dC5maXJlLCBjYik7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgdW5zdWJzY3JpYmU6IGZ1bmN0aW9uIChjYikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRleHQuc3Vic2NyaWJlcnMgPSBjb250ZXh0LnN1YnNjcmliZXJzLmZpbHRlcihmdW5jdGlvbiAoZm4pIHsgcmV0dXJuIGZuICE9PSBjYjsgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGV4dC5maXJlID0gY29udGV4dC5zdWJzY3JpYmVycy5yZWR1Y2UoY2hhaW5GdW5jdGlvbiwgZGVmYXVsdEZ1bmN0aW9uKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgZXZzW2V2ZW50TmFtZV0gPSBydltldmVudE5hbWVdID0gY29udGV4dDtcclxuICAgICAgICAgICAgcmV0dXJuIGNvbnRleHQ7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBhZGRDb25maWd1cmVkRXZlbnRzKGNmZykge1xyXG4gICAgICAgICAgICAvLyBldmVudHModGhpcywge3JlYWRpbmc6IFtmdW5jdGlvbkNoYWluLCBub3BdfSk7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGNmZykuZm9yRWFjaChmdW5jdGlvbiAoZXZlbnROYW1lKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgYXJncyA9IGNmZ1tldmVudE5hbWVdO1xyXG4gICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYXJncykpIHtcclxuICAgICAgICAgICAgICAgICAgICBhZGQoZXZlbnROYW1lLCBjZmdbZXZlbnROYW1lXVswXSwgY2ZnW2V2ZW50TmFtZV1bMV0pO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChhcmdzID09PSAnYXNhcCcpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSYXRoZXIgdGhhbiBhcHByb2FjaGluZyBldmVudCBzdWJzY3JpcHRpb24gdXNpbmcgYSBmdW5jdGlvbmFsIGFwcHJvYWNoLCB3ZSBoZXJlIGRvIGl0IGluIGEgZm9yLWxvb3Agd2hlcmUgc3Vic2NyaWJlciBpcyBleGVjdXRlZCBpbiBpdHMgb3duIHN0YWNrXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gZW5hYmxpbmcgdGhhdCBhbnkgZXhjZXB0aW9uIHRoYXQgb2NjdXIgd29udCBkaXN0dXJiIHRoZSBpbml0aWF0b3IgYW5kIGFsc28gbm90IG5lc2Nlc3NhcnkgYmUgY2F0Y2hlZCBhbmQgZm9yZ290dGVuLlxyXG4gICAgICAgICAgICAgICAgICAgIHZhciBjb250ZXh0ID0gYWRkKGV2ZW50TmFtZSwgbnVsbCwgZnVuY3Rpb24gZmlyZSgpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRleHQuc3Vic2NyaWJlcnMuZm9yRWFjaChmdW5jdGlvbiAoZm4pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFzYXAoZnVuY3Rpb24gZmlyZUV2ZW50KCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZuLmFwcGx5KGdsb2JhbCwgYXJncyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGV4dC5zdWJzY3JpYmUgPSBmdW5jdGlvbiAoZm4pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hhbmdlIGhvdyBzdWJzY3JpYmUgd29ya3MgdG8gbm90IHJlcGxhY2UgdGhlIGZpcmUgZnVuY3Rpb24gYnV0IHRvIGp1c3QgYWRkIHRoZSBzdWJzY3JpYmVyIHRvIHN1YnNjcmliZXJzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb250ZXh0LnN1YnNjcmliZXJzLmluZGV4T2YoZm4pID09PSAtMSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRleHQuc3Vic2NyaWJlcnMucHVzaChmbik7XHJcbiAgICAgICAgICAgICAgICAgICAgfTsgXHJcbiAgICAgICAgICAgICAgICAgICAgY29udGV4dC51bnN1YnNjcmliZSA9IGZ1bmN0aW9uIChmbikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGFuZ2UgaG93IHVuc3Vic2NyaWJlIHdvcmtzIGZvciB0aGUgc2FtZSByZWFzb24gYXMgYWJvdmUuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBpZHhPZkZuID0gY29udGV4dC5zdWJzY3JpYmVycy5pbmRleE9mKGZuKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlkeE9mRm4gIT09IC0xKSBjb250ZXh0LnN1YnNjcmliZXJzLnNwbGljZShpZHhPZkZuLCAxKTtcclxuICAgICAgICAgICAgICAgICAgICB9OyBcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIGV2ZW50IGNvbmZpZ1wiKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmdW5jdGlvbiBhZGRFdmVudEdyb3VwKGV2ZW50R3JvdXApIHtcclxuICAgICAgICAgICAgLy8gcHJvbWlzZS1iYXNlZCBldmVudCBncm91cCAoaS5lLiB3ZSBwcm9taXNlIHRvIGNhbGwgb25lIGFuZCBvbmx5IG9uZSBvZiB0aGUgZXZlbnRzIGluIHRoZSBwYWlyLCBhbmQgdG8gb25seSBjYWxsIGl0IG9uY2UuXHJcbiAgICAgICAgICAgIHZhciBkb25lID0gZmFsc2U7XHJcbiAgICAgICAgICAgIGV2ZW50R3JvdXAuZm9yRWFjaChmdW5jdGlvbiAobmFtZSkge1xyXG4gICAgICAgICAgICAgICAgYWRkKG5hbWUpLnN1YnNjcmliZShjaGVja0RvbmUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgZnVuY3Rpb24gY2hlY2tEb25lKCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGRvbmUpIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGRvbmUgPSB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IgKHZhciBpID0gMSwgbCA9IGFyZ3MubGVuZ3RoOyBpIDwgbDsgKytpKSB7XHJcbiAgICAgICAgICAgIGFkZChhcmdzW2ldKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBydjtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBhc3NlcnQoYikge1xyXG4gICAgICAgIGlmICghYikgdGhyb3cgbmV3IEVycm9yKFwiQXNzZXJ0aW9uIGZhaWxlZFwiKTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBhc2FwKGZuKSB7XHJcbiAgICAgICAgaWYgKGdsb2JhbC5zZXRJbW1lZGlhdGUpIHNldEltbWVkaWF0ZShmbik7IGVsc2Ugc2V0VGltZW91dChmbiwgMCk7XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIGZha2VBdXRvQ29tcGxldGUgPSBmdW5jdGlvbiAoKSB7IH07Ly8gV2lsbCBuZXZlciBiZSBjaGFuZ2VkLiBXZSBqdXN0IGZha2UgZm9yIHRoZSBJREUgdGhhdCB3ZSBjaGFuZ2UgaXQgKHNlZSBkb0Zha2VBdXRvQ29tcGxldGUoKSlcclxuICAgIHZhciBmYWtlID0gZmFsc2U7IC8vIFdpbGwgbmV2ZXIgYmUgY2hhbmdlZC4gV2UganVzdCBmYWtlIGZvciB0aGUgSURFIHRoYXQgd2UgY2hhbmdlIGl0IChzZWUgZG9GYWtlQXV0b0NvbXBsZXRlKCkpXHJcblxyXG4gICAgZnVuY3Rpb24gZG9GYWtlQXV0b0NvbXBsZXRlKGZuKSB7XHJcbiAgICAgICAgdmFyIHRvID0gc2V0VGltZW91dChmbiwgMTAwMCk7XHJcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRvKTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiB0cnljYXRjaChmbiwgcmVqZWN0LCBwc2QpIHtcclxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICB2YXIgb3V0ZXJQU0QgPSBQcm9taXNlLlBTRDsgLy8gU3VwcG9ydCBQcm9taXNlLXNwZWNpZmljIGRhdGEgKFBTRCkgaW4gY2FsbGJhY2sgY2FsbHNcclxuICAgICAgICAgICAgUHJvbWlzZS5QU0QgPSBwc2Q7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICByZWplY3QoZSk7XHJcbiAgICAgICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgICAgICBQcm9taXNlLlBTRCA9IG91dGVyUFNEO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiBnZXRCeUtleVBhdGgob2JqLCBrZXlQYXRoKSB7XHJcbiAgICAgICAgLy8gaHR0cDovL3d3dy53My5vcmcvVFIvSW5kZXhlZERCLyNzdGVwcy1mb3ItZXh0cmFjdGluZy1hLWtleS1mcm9tLWEtdmFsdWUtdXNpbmctYS1rZXktcGF0aFxyXG4gICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoa2V5UGF0aCkpIHJldHVybiBvYmpba2V5UGF0aF07IC8vIFRoaXMgbGluZSBpcyBtb3ZlZCBmcm9tIGxhc3QgdG8gZmlyc3QgZm9yIG9wdGltaXphdGlvbiBwdXJwb3NlLlxyXG4gICAgICAgIGlmICgha2V5UGF0aCkgcmV0dXJuIG9iajtcclxuICAgICAgICBpZiAodHlwZW9mIGtleVBhdGggIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgIHZhciBydiA9IFtdO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMCwgbCA9IGtleVBhdGgubGVuZ3RoOyBpIDwgbDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgdmFsID0gZ2V0QnlLZXlQYXRoKG9iaiwga2V5UGF0aFtpXSk7XHJcbiAgICAgICAgICAgICAgICBydi5wdXNoKHZhbCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIHJ2O1xyXG4gICAgICAgIH1cclxuICAgICAgICB2YXIgcGVyaW9kID0ga2V5UGF0aC5pbmRleE9mKCcuJyk7XHJcbiAgICAgICAgaWYgKHBlcmlvZCAhPT0gLTEpIHtcclxuICAgICAgICAgICAgdmFyIGlubmVyT2JqID0gb2JqW2tleVBhdGguc3Vic3RyKDAsIHBlcmlvZCldO1xyXG4gICAgICAgICAgICByZXR1cm4gaW5uZXJPYmogPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGdldEJ5S2V5UGF0aChpbm5lck9iaiwga2V5UGF0aC5zdWJzdHIocGVyaW9kICsgMSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHNldEJ5S2V5UGF0aChvYmosIGtleVBhdGgsIHZhbHVlKSB7XHJcbiAgICAgICAgaWYgKCFvYmogfHwga2V5UGF0aCA9PT0gdW5kZWZpbmVkKSByZXR1cm47XHJcbiAgICAgICAgaWYgKHR5cGVvZiBrZXlQYXRoICE9PSAnc3RyaW5nJyAmJiAnbGVuZ3RoJyBpbiBrZXlQYXRoKSB7XHJcbiAgICAgICAgICAgIGFzc2VydCh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnICYmICdsZW5ndGgnIGluIHZhbHVlKTtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBrZXlQYXRoLmxlbmd0aDsgaSA8IGw7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgc2V0QnlLZXlQYXRoKG9iaiwga2V5UGF0aFtpXSwgdmFsdWVbaV0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdmFyIHBlcmlvZCA9IGtleVBhdGguaW5kZXhPZignLicpO1xyXG4gICAgICAgICAgICBpZiAocGVyaW9kICE9PSAtMSkge1xyXG4gICAgICAgICAgICAgICAgdmFyIGN1cnJlbnRLZXlQYXRoID0ga2V5UGF0aC5zdWJzdHIoMCwgcGVyaW9kKTtcclxuICAgICAgICAgICAgICAgIHZhciByZW1haW5pbmdLZXlQYXRoID0ga2V5UGF0aC5zdWJzdHIocGVyaW9kICsgMSk7XHJcbiAgICAgICAgICAgICAgICBpZiAocmVtYWluaW5nS2V5UGF0aCA9PT0gXCJcIilcclxuICAgICAgICAgICAgICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgZGVsZXRlIG9ialtjdXJyZW50S2V5UGF0aF07IGVsc2Ugb2JqW2N1cnJlbnRLZXlQYXRoXSA9IHZhbHVlO1xyXG4gICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGlubmVyT2JqID0gb2JqW2N1cnJlbnRLZXlQYXRoXTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWlubmVyT2JqKSBpbm5lck9iaiA9IChvYmpbY3VycmVudEtleVBhdGhdID0ge30pO1xyXG4gICAgICAgICAgICAgICAgICAgIHNldEJ5S2V5UGF0aChpbm5lck9iaiwgcmVtYWluaW5nS2V5UGF0aCwgdmFsdWUpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIGRlbGV0ZSBvYmpba2V5UGF0aF07IGVsc2Ugb2JqW2tleVBhdGhdID0gdmFsdWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gZGVsQnlLZXlQYXRoKG9iaiwga2V5UGF0aCkge1xyXG4gICAgICAgIGlmICh0eXBlb2Yga2V5UGF0aCA9PT0gJ3N0cmluZycpXHJcbiAgICAgICAgICAgIHNldEJ5S2V5UGF0aChvYmosIGtleVBhdGgsIHVuZGVmaW5lZCk7XHJcbiAgICAgICAgZWxzZSBpZiAoJ2xlbmd0aCcgaW4ga2V5UGF0aClcclxuICAgICAgICAgICAgW10ubWFwLmNhbGwoa2V5UGF0aCwgZnVuY3Rpb24oa3ApIHtcclxuICAgICAgICAgICAgICAgICBzZXRCeUtleVBhdGgob2JqLCBrcCwgdW5kZWZpbmVkKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gc2hhbGxvd0Nsb25lKG9iaikge1xyXG4gICAgICAgIHZhciBydiA9IHt9O1xyXG4gICAgICAgIGZvciAodmFyIG0gaW4gb2JqKSB7XHJcbiAgICAgICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkobSkpIHJ2W21dID0gb2JqW21dO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcnY7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gZGVlcENsb25lKGFueSkge1xyXG4gICAgICAgIGlmICghYW55IHx8IHR5cGVvZiBhbnkgIT09ICdvYmplY3QnKSByZXR1cm4gYW55O1xyXG4gICAgICAgIHZhciBydjtcclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhbnkpKSB7XHJcbiAgICAgICAgICAgIHJ2ID0gW107XHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBsID0gYW55Lmxlbmd0aDsgaSA8IGw7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgcnYucHVzaChkZWVwQ2xvbmUoYW55W2ldKSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2UgaWYgKGFueSBpbnN0YW5jZW9mIERhdGUpIHtcclxuICAgICAgICAgICAgcnYgPSBuZXcgRGF0ZSgpO1xyXG4gICAgICAgICAgICBydi5zZXRUaW1lKGFueS5nZXRUaW1lKCkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJ2ID0gYW55LmNvbnN0cnVjdG9yID8gT2JqZWN0LmNyZWF0ZShhbnkuY29uc3RydWN0b3IucHJvdG90eXBlKSA6IHt9O1xyXG4gICAgICAgICAgICBmb3IgKHZhciBwcm9wIGluIGFueSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGFueS5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJ2W3Byb3BdID0gZGVlcENsb25lKGFueVtwcm9wXSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJ2O1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIGdldE9iamVjdERpZmYoYSwgYikge1xyXG4gICAgICAgIC8vIFRoaXMgaXMgYSBzaW1wbGlmaWVkIHZlcnNpb24gdGhhdCB3aWxsIGFsd2F5cyByZXR1cm4ga2V5cGF0aHMgb24gdGhlIHJvb3QgbGV2ZWwuXHJcbiAgICAgICAgLy8gSWYgZm9yIGV4YW1wbGUgYSBhbmQgYiBkaWZmZXJzIGJ5OiAoYS5zb21lUHJvcHNPYmplY3QueCAhPSBiLnNvbWVQcm9wc09iamVjdC54KSwgd2Ugd2lsbCByZXR1cm4gdGhhdCBcInNvbWVQcm9wc09iamVjdFwiIGlzIGNoYW5nZWRcclxuICAgICAgICAvLyBhbmQgbm90IFwic29tZVByb3BzT2JqZWN0LnhcIi4gVGhpcyBpcyBhY2NlcHRhYmxlIGFuZCB0cnVlIGJ1dCBjb3VsZCBiZSBvcHRpbWl6ZWQgdG8gc3VwcG9ydCBuZXN0bGVkIGNoYW5nZXMgaWYgdGhhdCB3b3VsZCBnaXZlIGFcclxuICAgICAgICAvLyBiaWcgb3B0aW1pemF0aW9uIGJlbmVmaXQuXHJcbiAgICAgICAgdmFyIHJ2ID0ge307XHJcbiAgICAgICAgZm9yICh2YXIgcHJvcCBpbiBhKSBpZiAoYS5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xyXG4gICAgICAgICAgICBpZiAoIWIuaGFzT3duUHJvcGVydHkocHJvcCkpXHJcbiAgICAgICAgICAgICAgICBydltwcm9wXSA9IHVuZGVmaW5lZDsgLy8gUHJvcGVydHkgcmVtb3ZlZFxyXG4gICAgICAgICAgICBlbHNlIGlmIChhW3Byb3BdICE9PSBiW3Byb3BdICYmIEpTT04uc3RyaW5naWZ5KGFbcHJvcF0pICE9IEpTT04uc3RyaW5naWZ5KGJbcHJvcF0pKVxyXG4gICAgICAgICAgICAgICAgcnZbcHJvcF0gPSBiW3Byb3BdOyAvLyBQcm9wZXJ0eSBjaGFuZ2VkXHJcbiAgICAgICAgfVxyXG4gICAgICAgIGZvciAodmFyIHByb3AgaW4gYikgaWYgKGIuaGFzT3duUHJvcGVydHkocHJvcCkgJiYgIWEuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcclxuICAgICAgICAgICAgcnZbcHJvcF0gPSBiW3Byb3BdOyAvLyBQcm9wZXJ0eSBhZGRlZFxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcnY7XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gcGFyc2VUeXBlKHR5cGUpIHtcclxuICAgICAgICBpZiAodHlwZW9mIHR5cGUgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG5ldyB0eXBlKCk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHR5cGUpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbcGFyc2VUeXBlKHR5cGVbMF0pXTtcclxuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgJiYgdHlwZW9mIHR5cGUgPT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgICAgIHZhciBydiA9IHt9O1xyXG4gICAgICAgICAgICBhcHBseVN0cnVjdHVyZShydiwgdHlwZSk7XHJcbiAgICAgICAgICAgIHJldHVybiBydjtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXR1cm4gdHlwZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZnVuY3Rpb24gYXBwbHlTdHJ1Y3R1cmUob2JqLCBzdHJ1Y3R1cmUpIHtcclxuICAgICAgICBPYmplY3Qua2V5cyhzdHJ1Y3R1cmUpLmZvckVhY2goZnVuY3Rpb24gKG1lbWJlcikge1xyXG4gICAgICAgICAgICB2YXIgdmFsdWUgPSBwYXJzZVR5cGUoc3RydWN0dXJlW21lbWJlcl0pO1xyXG4gICAgICAgICAgICBvYmpbbWVtYmVyXSA9IHZhbHVlO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIGV2ZW50UmVqZWN0SGFuZGxlcihyZWplY3QsIHNlbnRhbmNlKSB7XHJcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xyXG4gICAgICAgICAgICB2YXIgZXJyT2JqID0gKGV2ZW50ICYmIGV2ZW50LnRhcmdldC5lcnJvcikgfHwgbmV3IEVycm9yKCk7XHJcbiAgICAgICAgICAgIGlmIChzZW50YW5jZSkge1xyXG4gICAgICAgICAgICAgICAgdmFyIG9jY3VycmVkV2hlbiA9IFwiIG9jY3VycmVkIHdoZW4gXCIgKyBzZW50YW5jZS5tYXAoZnVuY3Rpb24gKHdvcmQpIHtcclxuICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKHR5cGVvZiAod29yZCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnZnVuY3Rpb24nOiByZXR1cm4gd29yZCgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdzdHJpbmcnOiByZXR1cm4gd29yZDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDogcmV0dXJuIEpTT04uc3RyaW5naWZ5KHdvcmQpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pLmpvaW4oXCIgXCIpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGVyck9iai5uYW1lKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZXJyT2JqLnRvU3RyaW5nID0gZnVuY3Rpb24gdG9TdHJpbmcoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBlcnJPYmoubmFtZSArIG9jY3VycmVkV2hlbiArIChlcnJPYmoubWVzc2FnZSA/IFwiLiBcIiArIGVyck9iai5tZXNzYWdlIDogXCJcIik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENvZGUgYmVsb3cgd29ya3MgZm9yIHN0YWNrZWQgZXhjZXB0aW9ucywgQlVUISBzdGFjayBpcyBuZXZlciBwcmVzZW50IGluIGV2ZW50IGVycm9ycyAobm90IGluIGFueSBvZiB0aGUgYnJvd3NlcnMpLiBTbyBpdCdzIG5vIHVzZSB0byBpbmNsdWRlIGl0IVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvKmRlbGV0ZSB0aGlzLnRvU3RyaW5nOyAvLyBQcm9oaWJpdGluZyBlbmRsZXNzIHJlY3Vyc2l2ZW5lc3MgaW4gSUUuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlcnJPYmouc3RhY2spIHJ2ICs9IChlcnJPYmouc3RhY2sgPyBcIi4gU3RhY2s6IFwiICsgZXJyT2JqLnN0YWNrIDogXCJcIik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudG9TdHJpbmcgPSB0b1N0cmluZztcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJ2OyovXHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZXJyT2JqID0gZXJyT2JqICsgb2NjdXJyZWRXaGVuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICByZWplY3QoZXJyT2JqKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChldmVudCkgey8vIE9sZCB2ZXJzaW9ucyBvZiBJbmRleGVkREJTaGltIGRvZXNudCBwcm92aWRlIGFuIGVycm9yIGV2ZW50XHJcbiAgICAgICAgICAgICAgICAvLyBTdG9wIGVycm9yIGZyb20gcHJvcGFnYXRpbmcgdG8gSURCVHJhbnNhY3Rpb24uIExldCB1cyBoYW5kbGUgdGhhdCBtYW51YWxseSBpbnN0ZWFkLlxyXG4gICAgICAgICAgICAgICAgaWYgKGV2ZW50LnN0b3BQcm9wYWdhdGlvbikgLy8gSW5kZXhlZERCU2hpbSBkb2VzbnQgc3VwcG9ydCB0aGlzXHJcbiAgICAgICAgICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICBpZiAoZXZlbnQucHJldmVudERlZmF1bHQpIC8vIEluZGV4ZWREQlNoaW0gZG9lc250IHN1cHBvcnQgdGhpc1xyXG4gICAgICAgICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHN0YWNrKGVycm9yKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICByZXR1cm4gZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBmdW5jdGlvbiBwcmV2ZW50RGVmYXVsdChlKSB7XHJcbiAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIGdsb2JhbERhdGFiYXNlTGlzdChjYikge1xyXG4gICAgICAgIHZhciB2YWwsXHJcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZSA9IERleGllLmRlcGVuZGVuY2llcy5sb2NhbFN0b3JhZ2U7XHJcbiAgICAgICAgaWYgKCFsb2NhbFN0b3JhZ2UpIHJldHVybiBjYihbXSk7IC8vIEVudnMgd2l0aG91dCBsb2NhbFN0b3JhZ2Ugc3VwcG9ydFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHZhbCA9IEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oJ0RleGllLkRhdGFiYXNlTmFtZXMnKSB8fCBcIltdXCIpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgdmFsID0gW107XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChjYih2YWwpKSB7XHJcbiAgICAgICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKCdEZXhpZS5EYXRhYmFzZU5hbWVzJywgSlNPTi5zdHJpbmdpZnkodmFsKSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vXHJcbiAgICAvLyBJbmRleFNwZWMgc3RydWN0XHJcbiAgICAvL1xyXG4gICAgZnVuY3Rpb24gSW5kZXhTcGVjKG5hbWUsIGtleVBhdGgsIHVuaXF1ZSwgbXVsdGksIGF1dG8sIGNvbXBvdW5kLCBkb3R0ZWQpIHtcclxuICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJuYW1lXCIgdHlwZT1cIlN0cmluZ1wiPjwvcGFyYW0+XHJcbiAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwia2V5UGF0aFwiIHR5cGU9XCJTdHJpbmdcIj48L3BhcmFtPlxyXG4gICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cInVuaXF1ZVwiIHR5cGU9XCJCb29sZWFuXCI+PC9wYXJhbT5cclxuICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJtdWx0aVwiIHR5cGU9XCJCb29sZWFuXCI+PC9wYXJhbT5cclxuICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJhdXRvXCIgdHlwZT1cIkJvb2xlYW5cIj48L3BhcmFtPlxyXG4gICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cImNvbXBvdW5kXCIgdHlwZT1cIkJvb2xlYW5cIj48L3BhcmFtPlxyXG4gICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cImRvdHRlZFwiIHR5cGU9XCJCb29sZWFuXCI+PC9wYXJhbT5cclxuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xyXG4gICAgICAgIHRoaXMua2V5UGF0aCA9IGtleVBhdGg7XHJcbiAgICAgICAgdGhpcy51bmlxdWUgPSB1bmlxdWU7XHJcbiAgICAgICAgdGhpcy5tdWx0aSA9IG11bHRpO1xyXG4gICAgICAgIHRoaXMuYXV0byA9IGF1dG87XHJcbiAgICAgICAgdGhpcy5jb21wb3VuZCA9IGNvbXBvdW5kO1xyXG4gICAgICAgIHRoaXMuZG90dGVkID0gZG90dGVkO1xyXG4gICAgICAgIHZhciBrZXlQYXRoU3JjID0gdHlwZW9mIGtleVBhdGggPT09ICdzdHJpbmcnID8ga2V5UGF0aCA6IGtleVBhdGggJiYgKCdbJyArIFtdLmpvaW4uY2FsbChrZXlQYXRoLCAnKycpICsgJ10nKTtcclxuICAgICAgICB0aGlzLnNyYyA9ICh1bmlxdWUgPyAnJicgOiAnJykgKyAobXVsdGkgPyAnKicgOiAnJykgKyAoYXV0byA/IFwiKytcIiA6IFwiXCIpICsga2V5UGF0aFNyYztcclxuICAgIH1cclxuXHJcbiAgICAvL1xyXG4gICAgLy8gVGFibGVTY2hlbWEgc3RydWN0XHJcbiAgICAvL1xyXG4gICAgZnVuY3Rpb24gVGFibGVTY2hlbWEobmFtZSwgcHJpbUtleSwgaW5kZXhlcywgaW5zdGFuY2VUZW1wbGF0ZSkge1xyXG4gICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cIm5hbWVcIiB0eXBlPVwiU3RyaW5nXCI+PC9wYXJhbT5cclxuICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJwcmltS2V5XCIgdHlwZT1cIkluZGV4U3BlY1wiPjwvcGFyYW0+XHJcbiAgICAgICAgLy8vIDxwYXJhbSBuYW1lPVwiaW5kZXhlc1wiIHR5cGU9XCJBcnJheVwiIGVsZW1lbnRUeXBlPVwiSW5kZXhTcGVjXCI+PC9wYXJhbT5cclxuICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJpbnN0YW5jZVRlbXBsYXRlXCIgdHlwZT1cIk9iamVjdFwiPjwvcGFyYW0+XHJcbiAgICAgICAgdGhpcy5uYW1lID0gbmFtZTtcclxuICAgICAgICB0aGlzLnByaW1LZXkgPSBwcmltS2V5IHx8IG5ldyBJbmRleFNwZWMoKTtcclxuICAgICAgICB0aGlzLmluZGV4ZXMgPSBpbmRleGVzIHx8IFtuZXcgSW5kZXhTcGVjKCldO1xyXG4gICAgICAgIHRoaXMuaW5zdGFuY2VUZW1wbGF0ZSA9IGluc3RhbmNlVGVtcGxhdGU7XHJcbiAgICAgICAgdGhpcy5tYXBwZWRDbGFzcyA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5pZHhCeU5hbWUgPSBpbmRleGVzLnJlZHVjZShmdW5jdGlvbiAoaGFzaFNldCwgaW5kZXgpIHtcclxuICAgICAgICAgICAgaGFzaFNldFtpbmRleC5uYW1lXSA9IGluZGV4O1xyXG4gICAgICAgICAgICByZXR1cm4gaGFzaFNldDtcclxuICAgICAgICB9LCB7fSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy9cclxuICAgIC8vIE1vZGlmeUVycm9yIENsYXNzIChleHRlbmRzIEVycm9yKVxyXG4gICAgLy9cclxuICAgIGZ1bmN0aW9uIE1vZGlmeUVycm9yKG1zZywgZmFpbHVyZXMsIHN1Y2Nlc3NDb3VudCwgZmFpbGVkS2V5cykge1xyXG4gICAgICAgIHRoaXMubmFtZSA9IFwiTW9kaWZ5RXJyb3JcIjtcclxuICAgICAgICB0aGlzLmZhaWx1cmVzID0gZmFpbHVyZXM7XHJcbiAgICAgICAgdGhpcy5mYWlsZWRLZXlzID0gZmFpbGVkS2V5cztcclxuICAgICAgICB0aGlzLnN1Y2Nlc3NDb3VudCA9IHN1Y2Nlc3NDb3VudDtcclxuICAgICAgICB0aGlzLm1lc3NhZ2UgPSBmYWlsdXJlcy5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuICAgIGRlcml2ZShNb2RpZnlFcnJvcikuZnJvbShFcnJvcik7XHJcblxyXG4gICAgLy9cclxuICAgIC8vIFN0YXRpYyBkZWxldGUoKSBtZXRob2QuXHJcbiAgICAvL1xyXG4gICAgRGV4aWUuZGVsZXRlID0gZnVuY3Rpb24gKGRhdGFiYXNlTmFtZSkge1xyXG4gICAgICAgIHZhciBkYiA9IG5ldyBEZXhpZShkYXRhYmFzZU5hbWUpLFxyXG4gICAgICAgICAgICBwcm9taXNlID0gZGIuZGVsZXRlKCk7XHJcbiAgICAgICAgcHJvbWlzZS5vbmJsb2NrZWQgPSBmdW5jdGlvbiAoZm4pIHtcclxuICAgICAgICAgICAgZGIub24oXCJibG9ja2VkXCIsIGZuKTtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgICAgfTtcclxuICAgICAgICByZXR1cm4gcHJvbWlzZTtcclxuICAgIH07IFxyXG5cclxuICAgIC8vXHJcbiAgICAvLyBTdGF0aWMgbWV0aG9kIGZvciByZXRyaWV2aW5nIGEgbGlzdCBvZiBhbGwgZXhpc3RpbmcgZGF0YWJhc2VzIGF0IGN1cnJlbnQgaG9zdC5cclxuICAgIC8vXHJcbiAgICBEZXhpZS5nZXREYXRhYmFzZU5hbWVzID0gZnVuY3Rpb24gKGNiKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICAgICAgdmFyIGdldERhdGFiYXNlTmFtZXMgPSBnZXROYXRpdmVHZXREYXRhYmFzZU5hbWVzRm4oKTtcclxuICAgICAgICAgICAgaWYgKGdldERhdGFiYXNlTmFtZXMpIHsgLy8gSW4gY2FzZSBnZXREYXRhYmFzZU5hbWVzKCkgYmVjb21lcyBzdGFuZGFyZCwgbGV0J3MgcHJlcGFyZSB0byBzdXBwb3J0IGl0OlxyXG4gICAgICAgICAgICAgICAgdmFyIHJlcSA9IGdldERhdGFiYXNlTmFtZXMoKTtcclxuICAgICAgICAgICAgICAgIHJlcS5vbnN1Y2Nlc3MgPSBmdW5jdGlvbiAoZXZlbnQpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKFtdLnNsaWNlLmNhbGwoZXZlbnQudGFyZ2V0LnJlc3VsdCwgMCkpOyAvLyBDb252ZXJzdCBET01TdHJpbmdMaXN0IHRvIEFycmF5PFN0cmluZz5cclxuICAgICAgICAgICAgICAgIH07IFxyXG4gICAgICAgICAgICAgICAgcmVxLm9uZXJyb3IgPSBldmVudFJlamVjdEhhbmRsZXIocmVqZWN0KTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGdsb2JhbERhdGFiYXNlTGlzdChmdW5jdGlvbiAodmFsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh2YWwpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSkudGhlbihjYik7XHJcbiAgICB9OyBcclxuXHJcbiAgICBEZXhpZS5kZWZpbmVDbGFzcyA9IGZ1bmN0aW9uIChzdHJ1Y3R1cmUpIHtcclxuICAgICAgICAvLy8gPHN1bW1hcnk+XHJcbiAgICAgICAgLy8vICAgICBDcmVhdGUgYSBqYXZhc2NyaXB0IGNvbnN0cnVjdG9yIGJhc2VkIG9uIGdpdmVuIHRlbXBsYXRlIGZvciB3aGljaCBwcm9wZXJ0aWVzIHRvIGV4cGVjdCBpbiB0aGUgY2xhc3MuXHJcbiAgICAgICAgLy8vICAgICBBbnkgcHJvcGVydHkgdGhhdCBpcyBhIGNvbnN0cnVjdG9yIGZ1bmN0aW9uIHdpbGwgYWN0IGFzIGEgdHlwZS4gU28ge25hbWU6IFN0cmluZ30gd2lsbCBiZSBlcXVhbCB0byB7bmFtZTogbmV3IFN0cmluZygpfS5cclxuICAgICAgICAvLy8gPC9zdW1tYXJ5PlxyXG4gICAgICAgIC8vLyA8cGFyYW0gbmFtZT1cInN0cnVjdHVyZVwiPkhlbHBzIElERSBjb2RlIGNvbXBsZXRpb24gYnkga25vd2luZyB0aGUgbWVtYmVycyB0aGF0IG9iamVjdHMgY29udGFpbiBhbmQgbm90IGp1c3QgdGhlIGluZGV4ZXMuIEFsc29cclxuICAgICAgICAvLy8ga25vdyB3aGF0IHR5cGUgZWFjaCBtZW1iZXIgaGFzLiBFeGFtcGxlOiB7bmFtZTogU3RyaW5nLCBlbWFpbEFkZHJlc3NlczogW1N0cmluZ10sIHByb3BlcnRpZXM6IHtzaG9lU2l6ZTogTnVtYmVyfX08L3BhcmFtPlxyXG5cclxuICAgICAgICAvLyBEZWZhdWx0IGNvbnN0cnVjdG9yIGFibGUgdG8gY29weSBnaXZlbiBwcm9wZXJ0aWVzIGludG8gdGhpcyBvYmplY3QuXHJcbiAgICAgICAgZnVuY3Rpb24gQ2xhc3MocHJvcGVydGllcykge1xyXG4gICAgICAgICAgICAvLy8gPHBhcmFtIG5hbWU9XCJwcm9wZXJ0aWVzXCIgdHlwZT1cIk9iamVjdFwiIG9wdGlvbmFsPVwidHJ1ZVwiPlByb3BlcnRpZXMgdG8gaW5pdGlhbGl6ZSBvYmplY3Qgd2l0aC5cclxuICAgICAgICAgICAgLy8vIDwvcGFyYW0+XHJcbiAgICAgICAgICAgIHByb3BlcnRpZXMgPyBleHRlbmQodGhpcywgcHJvcGVydGllcykgOiBmYWtlICYmIGFwcGx5U3RydWN0dXJlKHRoaXMsIHN0cnVjdHVyZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBDbGFzcztcclxuICAgIH07IFxyXG5cclxuICAgIERleGllLmlnbm9yZVRyYW5zYWN0aW9uID0gZnVuY3Rpb24gKHNjb3BlRnVuYykge1xyXG4gICAgICAgIC8vIEluIGNhc2UgY2FsbGVyIGlzIHdpdGhpbiBhIHRyYW5zYWN0aW9uIGJ1dCBuZWVkcyB0byBjcmVhdGUgYSBzZXBhcmF0ZSB0cmFuc2FjdGlvbi5cclxuICAgICAgICAvLyBFeGFtcGxlIG9mIHVzYWdlOlxyXG4gICAgICAgIC8vIFxyXG4gICAgICAgIC8vIExldCdzIHNheSB3ZSBoYXZlIGEgbG9nZ2VyIGZ1bmN0aW9uIGluIG91ciBhcHAuIE90aGVyIGFwcGxpY2F0aW9uLWxvZ2ljIHNob3VsZCBiZSB1bmF3YXJlIG9mIHRoZVxyXG4gICAgICAgIC8vIGxvZ2dlciBmdW5jdGlvbiBhbmQgbm90IG5lZWQgdG8gaW5jbHVkZSB0aGUgJ2xvZ2VudHJpZXMnIHRhYmxlIGluIGFsbCB0cmFuc2FjdGlvbiBpdCBwZXJmb3Jtcy5cclxuICAgICAgICAvLyBUaGUgbG9nZ2luZyBzaG91bGQgYWx3YXlzIGJlIGRvbmUgaW4gYSBzZXBhcmF0ZSB0cmFuc2FjdGlvbiBhbmQgbm90IGJlIGRlcGVuZGFudCBvbiB0aGUgY3VycmVudFxyXG4gICAgICAgIC8vIHJ1bm5pbmcgdHJhbnNhY3Rpb24gY29udGV4dC4gVGhlbiB5b3UgY291bGQgdXNlIERleGllLmlnbm9yZVRyYW5zYWN0aW9uKCkgdG8gcnVuIGNvZGUgdGhhdCBzdGFydHMgYSBuZXcgdHJhbnNhY3Rpb24uXHJcbiAgICAgICAgLy9cclxuICAgICAgICAvLyAgICAgRGV4aWUuaWdub3JlVHJhbnNhY3Rpb24oZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgLy8gICAgICAgICBkYi5sb2dlbnRyaWVzLmFkZChuZXdMb2dFbnRyeSk7XHJcbiAgICAgICAgLy8gICAgIH0pO1xyXG4gICAgICAgIC8vXHJcbiAgICAgICAgLy8gVW5sZXNzIHVzaW5nIERleGllLmlnbm9yZVRyYW5zYWN0aW9uKCksIHRoZSBhYm92ZSBleGFtcGxlIHdvdWxkIHRyeSB0byByZXVzZSB0aGUgY3VycmVudCB0cmFuc2FjdGlvblxyXG4gICAgICAgIC8vIGluIGN1cnJlbnQgUHJvbWlzZS1zY29wZS5cclxuICAgICAgICAvL1xyXG4gICAgICAgIC8vIEFuIGFsdGVybmF0aXZlIHRvIERleGllLmlnbm9yZVRyYW5zYWN0aW9uKCkgd291bGQgYmUgc2V0SW1tZWRpYXRlKCkgb3Igc2V0VGltZW91dCgpLiBUaGUgcmVhc29uIHdlIHN0aWxsIHByb3ZpZGUgYW5cclxuICAgICAgICAvLyBBUEkgZm9yIHRoaXMgYmVjYXVzZVxyXG4gICAgICAgIC8vICAxKSBUaGUgaW50ZW50aW9uIG9mIHdyaXRpbmcgdGhlIHN0YXRlbWVudCBjb3VsZCBiZSB1bmNsZWFyIGlmIHVzaW5nIHNldEltbWVkaWF0ZSgpIG9yIHNldFRpbWVvdXQoKS5cclxuICAgICAgICAvLyAgMikgc2V0VGltZW91dCgpIHdvdWxkIHdhaXQgdW5uZXNjZXNzYXJ5IHVudGlsIGZpcmluZy4gVGhpcyBpcyBob3dldmVyIG5vdCB0aGUgY2FzZSB3aXRoIHNldEltbWVkaWF0ZSgpLlxyXG4gICAgICAgIC8vICAzKSBzZXRJbW1lZGlhdGUoKSBpcyBub3Qgc3VwcG9ydGVkIGluIHRoZSBFUyBzdGFuZGFyZC5cclxuICAgICAgICByZXR1cm4gUHJvbWlzZS5uZXdQU0QoZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICBQcm9taXNlLlBTRC50cmFucyA9IG51bGw7XHJcbiAgICAgICAgICAgIHJldHVybiBzY29wZUZ1bmMoKTtcclxuICAgICAgICB9KTtcclxuICAgIH07XHJcbiAgICBEZXhpZS5zcGF3biA9IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICBpZiAoZ2xvYmFsLmNvbnNvbGUpIGNvbnNvbGUud2FybihcIkRleGllLnNwYXduKCkgaXMgZGVwcmVjYXRlZC4gVXNlIERleGllLmlnbm9yZVRyYW5zYWN0aW9uKCkgaW5zdGVhZC5cIik7XHJcbiAgICAgICAgcmV0dXJuIERleGllLmlnbm9yZVRyYW5zYWN0aW9uLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XHJcbiAgICB9XHJcblxyXG4gICAgRGV4aWUudmlwID0gZnVuY3Rpb24gKGZuKSB7XHJcbiAgICAgICAgLy8gVG8gYmUgdXNlZCBieSBzdWJzY3JpYmVycyB0byB0aGUgb24oJ3JlYWR5JykgZXZlbnQuXHJcbiAgICAgICAgLy8gVGhpcyB3aWxsIGxldCBjYWxsZXIgdGhyb3VnaCB0byBhY2Nlc3MgREIgZXZlbiB3aGVuIGl0IGlzIGJsb2NrZWQgd2hpbGUgdGhlIGRiLnJlYWR5KCkgc3Vic2NyaWJlcnMgYXJlIGZpcmluZy5cclxuICAgICAgICAvLyBUaGlzIHdvdWxkIGhhdmUgd29ya2VkIGF1dG9tYXRpY2FsbHkgaWYgd2Ugd2VyZSBjZXJ0YWluIHRoYXQgdGhlIFByb3ZpZGVyIHdhcyB1c2luZyBEZXhpZS5Qcm9taXNlIGZvciBhbGwgYXN5bmNyb25pYyBvcGVyYXRpb25zLiBUaGUgcHJvbWlzZSBQU0RcclxuICAgICAgICAvLyBmcm9tIHRoZSBwcm92aWRlci5jb25uZWN0KCkgY2FsbCB3b3VsZCB0aGVuIGJlIGRlcml2ZWQgYWxsIHRoZSB3YXkgdG8gd2hlbiBwcm92aWRlciB3b3VsZCBjYWxsIGxvY2FsRGF0YWJhc2UuYXBwbHlDaGFuZ2VzKCkuIEJ1dCBzaW5jZVxyXG4gICAgICAgIC8vIHRoZSBwcm92aWRlciBtb3JlIGxpa2VseSBpcyB1c2luZyBub24tcHJvbWlzZSBhc3luYyBBUElzIG9yIG90aGVyIHRoZW5hYmxlIGltcGxlbWVudGF0aW9ucywgd2UgY2Fubm90IGFzc3VtZSB0aGF0LlxyXG4gICAgICAgIC8vIE5vdGUgdGhhdCB0aGlzIG1ldGhvZCBpcyBvbmx5IHVzZWZ1bCBmb3Igb24oJ3JlYWR5Jykgc3Vic2NyaWJlcnMgdGhhdCBpcyByZXR1cm5pbmcgYSBQcm9taXNlIGZyb20gdGhlIGV2ZW50LiBJZiBub3QgdXNpbmcgdmlwKClcclxuICAgICAgICAvLyB0aGUgZGF0YWJhc2UgY291bGQgZGVhZGxvY2sgc2luY2UgaXQgd29udCBvcGVuIHVudGlsIHRoZSByZXR1cm5lZCBQcm9taXNlIGlzIHJlc29sdmVkLCBhbmQgYW55IG5vbi1WSVBlZCBvcGVyYXRpb24gc3RhcnRlZCBieVxyXG4gICAgICAgIC8vIHRoZSBjYWxsZXIgd2lsbCBub3QgcmVzb2x2ZSB1bnRpbCBkYXRhYmFzZSBpcyBvcGVuZWQuXHJcbiAgICAgICAgcmV0dXJuIFByb21pc2UubmV3UFNEKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgUHJvbWlzZS5QU0QubGV0VGhyb3VnaCA9IHRydWU7IC8vIE1ha2Ugc3VyZSB3ZSBhcmUgbGV0IHRocm91Z2ggaWYgc3RpbGwgYmxvY2tpbmcgZGIgZHVlIHRvIG9ucmVhZHkgaXMgZmlyaW5nLlxyXG4gICAgICAgICAgICByZXR1cm4gZm4oKTtcclxuICAgICAgICB9KTtcclxuICAgIH07IFxyXG5cclxuICAgIC8vIERleGllLmN1cnJlbnRUcmFuc2FjdGlvbiBwcm9wZXJ0eS4gT25seSBhcHBsaWNhYmxlIGZvciB0cmFuc2FjdGlvbnMgZW50ZXJlZCB1c2luZyB0aGUgbmV3IFwidHJhbnNhY3QoKVwiIG1ldGhvZC5cclxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShEZXhpZSwgXCJjdXJyZW50VHJhbnNhY3Rpb25cIiwge1xyXG4gICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAvLy8gPHJldHVybnMgdHlwZT1cIlRyYW5zYWN0aW9uXCI+PC9yZXR1cm5zPlxyXG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5QU0QgJiYgUHJvbWlzZS5QU0QudHJhbnMgfHwgbnVsbDtcclxuICAgICAgICB9XHJcbiAgICB9KTsgXHJcblxyXG4gICAgZnVuY3Rpb24gc2FmYXJpTXVsdGlTdG9yZUZpeChzdG9yZU5hbWVzKSB7XHJcbiAgICAgICAgcmV0dXJuIHN0b3JlTmFtZXMubGVuZ3RoID09PSAxID8gc3RvcmVOYW1lc1swXSA6IHN0b3JlTmFtZXM7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRXhwb3J0IG91ciBQcm9taXNlIGltcGxlbWVudGF0aW9uIHNpbmNlIGl0IGNhbiBiZSBoYW5keSBhcyBhIHN0YW5kYWxvbmUgUHJvbWlzZSBpbXBsZW1lbnRhdGlvblxyXG4gICAgRGV4aWUuUHJvbWlzZSA9IFByb21pc2U7XHJcbiAgICAvLyBFeHBvcnQgb3VyIGRlcml2ZS9leHRlbmQvb3ZlcnJpZGUgbWV0aG9kb2xvZ3lcclxuICAgIERleGllLmRlcml2ZSA9IGRlcml2ZTtcclxuICAgIERleGllLmV4dGVuZCA9IGV4dGVuZDtcclxuICAgIERleGllLm92ZXJyaWRlID0gb3ZlcnJpZGU7XHJcbiAgICAvLyBFeHBvcnQgb3VyIGV2ZW50cygpIGZ1bmN0aW9uIC0gY2FuIGJlIGhhbmR5IGFzIGEgdG9vbGtpdFxyXG4gICAgRGV4aWUuZXZlbnRzID0gZXZlbnRzO1xyXG4gICAgRGV4aWUuZ2V0QnlLZXlQYXRoID0gZ2V0QnlLZXlQYXRoO1xyXG4gICAgRGV4aWUuc2V0QnlLZXlQYXRoID0gc2V0QnlLZXlQYXRoO1xyXG4gICAgRGV4aWUuZGVsQnlLZXlQYXRoID0gZGVsQnlLZXlQYXRoO1xyXG4gICAgRGV4aWUuc2hhbGxvd0Nsb25lID0gc2hhbGxvd0Nsb25lO1xyXG4gICAgRGV4aWUuZGVlcENsb25lID0gZGVlcENsb25lO1xyXG4gICAgRGV4aWUuYWRkb25zID0gW107XHJcbiAgICBEZXhpZS5mYWtlQXV0b0NvbXBsZXRlID0gZmFrZUF1dG9Db21wbGV0ZTtcclxuICAgIERleGllLmFzYXAgPSBhc2FwO1xyXG4gICAgLy8gRXhwb3J0IG91ciBzdGF0aWMgY2xhc3Nlc1xyXG4gICAgRGV4aWUuTW9kaWZ5RXJyb3IgPSBNb2RpZnlFcnJvcjtcclxuICAgIERleGllLk11bHRpTW9kaWZ5RXJyb3IgPSBNb2RpZnlFcnJvcjsgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eSBwcmUgMC45LjhcclxuICAgIERleGllLkluZGV4U3BlYyA9IEluZGV4U3BlYztcclxuICAgIERleGllLlRhYmxlU2NoZW1hID0gVGFibGVTY2hlbWE7XHJcbiAgICAvL1xyXG4gICAgLy8gRGVwZW5kZW5jaWVzXHJcbiAgICAvL1xyXG4gICAgLy8gVGhlc2Ugd2lsbCBhdXRvbWF0aWNhbGx5IHdvcmsgaW4gYnJvd3NlcnMgd2l0aCBpbmRleGVkREIgc3VwcG9ydCwgb3Igd2hlcmUgYW4gaW5kZXhlZERCIHBvbHlmaWxsIGhhcyBiZWVuIGluY2x1ZGVkLlxyXG4gICAgLy9cclxuICAgIC8vIEluIG5vZGUuanMsIGhvd2V2ZXIsIHRoZXNlIHByb3BlcnRpZXMgbXVzdCBiZSBzZXQgXCJtYW51YWxseVwiIGJlZm9yZSBpbnN0YW5zaWF0aW5nIGEgbmV3IERleGllKCkuIEZvciBub2RlLmpzLCB5b3UgbmVlZCB0byByZXF1aXJlIGluZGV4ZWRkYi1qcyBvciBzaW1pbGFyIGFuZCB0aGVuIHNldCB0aGVzZSBkZXBzLlxyXG4gICAgLy9cclxuICAgIHZhciBpZGJzaGltID0gZ2xvYmFsLmlkYk1vZHVsZXMgJiYgZ2xvYmFsLmlkYk1vZHVsZXMuc2hpbUluZGV4ZWREQiA/IGdsb2JhbC5pZGJNb2R1bGVzIDoge307XHJcbiAgICBEZXhpZS5kZXBlbmRlbmNpZXMgPSB7XHJcbiAgICAgICAgLy8gUmVxdWlyZWQ6XHJcbiAgICAgICAgLy8gTk9URTogVGhlIFwiX1wiLXByZWZpeGVkIHZlcnNpb25zIGFyZSBmb3IgcHJpb3JpdGl6aW5nIElEQi1zaGltIG9uIElPUzggYmVmb3JlIHRoZSBuYXRpdmUgSURCIGluIGNhc2UgdGhlIHNoaW0gd2FzIGluY2x1ZGVkLlxyXG4gICAgICAgIGluZGV4ZWREQjogaWRic2hpbS5zaGltSW5kZXhlZERCIHx8IGdsb2JhbC5pbmRleGVkREIgfHwgZ2xvYmFsLm1vekluZGV4ZWREQiB8fCBnbG9iYWwud2Via2l0SW5kZXhlZERCIHx8IGdsb2JhbC5tc0luZGV4ZWREQixcclxuICAgICAgICBJREJLZXlSYW5nZTogaWRic2hpbS5JREJLZXlSYW5nZSB8fCBnbG9iYWwuSURCS2V5UmFuZ2UgfHwgZ2xvYmFsLndlYmtpdElEQktleVJhbmdlLFxyXG4gICAgICAgIElEQlRyYW5zYWN0aW9uOiBpZGJzaGltLklEQlRyYW5zYWN0aW9uIHx8IGdsb2JhbC5JREJUcmFuc2FjdGlvbiB8fCBnbG9iYWwud2Via2l0SURCVHJhbnNhY3Rpb24sXHJcbiAgICAgICAgLy8gT3B0aW9uYWw6XHJcbiAgICAgICAgRXJyb3I6IGdsb2JhbC5FcnJvciB8fCBTdHJpbmcsXHJcbiAgICAgICAgU3ludGF4RXJyb3I6IGdsb2JhbC5TeW50YXhFcnJvciB8fCBTdHJpbmcsXHJcbiAgICAgICAgVHlwZUVycm9yOiBnbG9iYWwuVHlwZUVycm9yIHx8IFN0cmluZyxcclxuICAgICAgICBET01FcnJvcjogZ2xvYmFsLkRPTUVycm9yIHx8IFN0cmluZyxcclxuICAgICAgICBsb2NhbFN0b3JhZ2U6ICgodHlwZW9mIGNocm9tZSAhPT0gXCJ1bmRlZmluZWRcIiAmJiBjaHJvbWUgIT09IG51bGwgPyBjaHJvbWUuc3RvcmFnZSA6IHZvaWQgMCkgIT0gbnVsbCA/IG51bGwgOiBnbG9iYWwubG9jYWxTdG9yYWdlKVxyXG4gICAgfTsgXHJcblxyXG4gICAgLy8gQVBJIFZlcnNpb24gTnVtYmVyOiBUeXBlIE51bWJlciwgbWFrZSBzdXJlIHRvIGFsd2F5cyBzZXQgYSB2ZXJzaW9uIG51bWJlciB0aGF0IGNhbiBiZSBjb21wYXJhYmxlIGNvcnJlY3RseS4gRXhhbXBsZTogMC45LCAwLjkxLCAwLjkyLCAxLjAsIDEuMDEsIDEuMSwgMS4yLCAxLjIxLCBldGMuXHJcbiAgICBEZXhpZS52ZXJzaW9uID0gMS4yMDtcclxuXHJcbiAgICBmdW5jdGlvbiBnZXROYXRpdmVHZXREYXRhYmFzZU5hbWVzRm4oKSB7XHJcbiAgICAgICAgdmFyIGluZGV4ZWREQiA9IERleGllLmRlcGVuZGVuY2llcy5pbmRleGVkREI7XHJcbiAgICAgICAgdmFyIGZuID0gaW5kZXhlZERCICYmIChpbmRleGVkREIuZ2V0RGF0YWJhc2VOYW1lcyB8fCBpbmRleGVkREIud2Via2l0R2V0RGF0YWJhc2VOYW1lcyk7XHJcbiAgICAgICAgcmV0dXJuIGZuICYmIGZuLmJpbmQoaW5kZXhlZERCKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBFeHBvcnQgRGV4aWUgdG8gd2luZG93IG9yIGFzIGEgbW9kdWxlIGRlcGVuZGluZyBvbiBlbnZpcm9ubWVudC5cclxuICAgIHB1Ymxpc2goXCJEZXhpZVwiLCBEZXhpZSk7XHJcblxyXG4gICAgLy8gRm9vbCBJREUgdG8gaW1wcm92ZSBhdXRvY29tcGxldGUuIFRlc3RlZCB3aXRoIFZpc3VhbCBTdHVkaW8gMjAxMyBhbmQgMjAxNS5cclxuICAgIGRvRmFrZUF1dG9Db21wbGV0ZShmdW5jdGlvbigpIHtcclxuICAgICAgICBEZXhpZS5mYWtlQXV0b0NvbXBsZXRlID0gZmFrZUF1dG9Db21wbGV0ZSA9IGRvRmFrZUF1dG9Db21wbGV0ZTtcclxuICAgICAgICBEZXhpZS5mYWtlID0gZmFrZSA9IHRydWU7XHJcbiAgICB9KTtcclxufSkuYXBwbHkobnVsbCxcclxuXHJcbiAgICAvLyBBTUQ6XHJcbiAgICB0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQgP1xyXG4gICAgW3NlbGYgfHwgd2luZG93LCBmdW5jdGlvbiAobmFtZSwgdmFsdWUpIHsgZGVmaW5lKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHZhbHVlOyB9KTsgfV0gOlxyXG5cclxuICAgIC8vIENvbW1vbkpTOlxyXG4gICAgdHlwZW9mIGdsb2JhbCAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMgP1xyXG4gICAgW2dsb2JhbCwgZnVuY3Rpb24gKG5hbWUsIHZhbHVlKSB7IG1vZHVsZS5leHBvcnRzID0gdmFsdWU7IH1dXHJcblxyXG4gICAgLy8gVmFuaWxsYSBIVE1MIGFuZCBXZWJXb3JrZXJzOlxyXG4gICAgOiBbc2VsZiB8fCB3aW5kb3csIGZ1bmN0aW9uIChuYW1lLCB2YWx1ZSkgeyAoc2VsZiB8fCB3aW5kb3cpW25hbWVdID0gdmFsdWU7IH1dKTtcclxuXHJcbiJdfQ==
