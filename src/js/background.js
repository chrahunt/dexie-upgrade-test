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
