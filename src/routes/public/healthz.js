module.exports = (router) => {
  router.get("/healthz", (req, res) => {
    res.status(200).json({ status: "ok", layer: "public" });
  });
};
