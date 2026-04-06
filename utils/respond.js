const ok = (res, data = {}, message = 'OK', status = 200) =>
  res.status(status).json({
    ok: true,
    message,
    data,
  });

const fail = (res, message = 'Request failed.', status = 400, extra = {}) =>
  res.status(status).json({
    ok: false,
    message,
    ...extra,
  });

module.exports = { ok, fail };
