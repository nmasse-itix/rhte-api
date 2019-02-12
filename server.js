var express = require("express");
var app = express();
var router = express.Router();
var port = 8080;

router.use(function (req, res, next) {
  next();
  console.log("%s %s => %i", req.method, req.originalUrl, res.statusCode);
});

router.get("/location", function(req, res) {
  var response = { "Location": "on-line" };
  res.type('application/json')
     .send(JSON.stringify(response))
     .end();
});

router.get("/timeframe",function(req, res) {
  var response = { "From": "19/02/2019", "To": "19/02/2019" };
  res.type('application/json')
     .send(JSON.stringify(response))
     .end();
});

router.get("/participants",function(req, res) {
  var response = [ "Nicolas", "David" ];
  res.type('application/json')
     .send(JSON.stringify(response))
     .end();
});

app.use("/",router);

app.use("*",function(req, res) {
  res.status(404).send("Not found");
});

app.listen(port, function() {
  console.log("Live at Port %i", port);
});
