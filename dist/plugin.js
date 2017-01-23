'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var Status = {
  Pending: 'pending',
  Accepted: 'accepted',
  Requested: 'requested'
};

var Friendship = {
  status: { type: String, enum: Object.values(Status) },
  added: { type: Date }
};

var defaultOptions = {
  pathName: 'friends',
  doIndex: true
};

module.exports = friendsPlugin;

function friendsPlugin(options) {
  var _defaultOptions$optio = _extends({}, defaultOptions, options),
      pathName = _defaultOptions$optio.pathName,
      doIndex = _defaultOptions$optio.doIndex;

  // Fields to add to the extending model


  var fields = _defineProperty({}, pathName, { type: [Friendship], select: false });

  /**
   * Generate a function to return one side of a friendship between
   * two models
   *
   * @param Model the extending model
   * @param m1 the model or model _id being queried
   * @param m2 the model or model _id whose friendship is queried for
   * @param that context
   *
   * @returns a function which will call back with an friendship for m2 on m1
   * @api private
   */
  var friendshipBetween = function friendshipBetween(m1, m2, that) {
    return that.findById(m1, _defineProperty({}, pathName, { $elemMatch: { _id: m2 } })).then(function (doc) {
      if (!doc) {
        return Promise.reject('Friendship not found');
      }

      return doc[pathName][0];
    });
  };

  return function friends(schema) {
    // add the embedded friends
    schema.add(fields);

    if (doIndex) {
      schema.index(_defineProperty({}, pathName + '._id', 1), {
        name: 'friendsplugin'
      });
    }

    /**
     * Send friend request from "friender" to "friend".  Calls back with
     * an object containing the two resulting friend objects
     *
     * On first request, will result in a "requested" friendship for the
     * first party and a "pending" friendship for the second.
     *
     * Reciprocating the request (friendee back to friender) will accept it.
     *
     * @param {Model} m1 the "friender" model doc or _id doing the reqesting
     * @param {Model} m2 the "friendee" model doc or _id being requested
     * @returns {Promise}
     */
    schema.statics.requestFriend = function (m1, m2) {
      var _this = this;

      m1 = m1._id || m1;
      m2 = m2._id || m2;

      var updateFriendship = function updateFriendship(m1, m2, fship) {
        return _this.findOneAndUpdate(_defineProperty({
          _id: m1
        }, pathName, { $elemMatch: { _id: m2 } }), {
          $set: _defineProperty({}, pathName + '.$.status', fship.status)
        }, { new: false }).then(function () {
          return fship;
        });
      };

      var createFriendship = function createFriendship(m1, m2, fship) {
        fship.added = new Date();

        return _this.findOneAndUpdate({ _id: m1 }, {
          $push: _defineProperty({}, pathName, fship)
        }, { new: false }).then(function () {
          return fship;
        });
      };

      return Promise.all([friendshipBetween(m1, m2, this), friendshipBetween(m2, m1, this)]).then(function (_ref) {
        var _ref2 = _slicedToArray(_ref, 2),
            m1Res = _ref2[0],
            m2Res = _ref2[1];

        var hasfship = !!m1Res;
        var fship = m1Res || { _id: m2 };
        var oid = fship._id;
        var ostatus = fship.status;

        var steps = [];

        // m2 has no friendship, add a new pending friendship, mark
        // m1's status as requested
        if (!m2Res) {
          fship.status = Status.Requested;

          steps[0] = createFriendship(m2, m1, {
            _id: m1,
            status: Status.Pending
          });
        } else {
          switch (m2Res.status) {
            // m2 status is still pending, no update
            case Status.Pending:
              fship.status = Status.Requested;
              break;
            // m2 status is accepted already, no update
            case Status.Accepted:
              fship.status = Status.Accepted;
              break;
            // m2 already requested m1, mark BOTH friendships as accepted
            case Status.Requested:
              fship.status = Status.Accepted;
              steps[0] = updateFriendship(m2, m1, {
                status: Status.Accepted
              });
              break;
          }
        }

        // If no update was necessary, send the remote friendship back directly
        if (!steps[0]) {
          steps[0] = Promise.resolve(m2Res);
        }

        // If no update was necessary, send the local friendship back directly
        if (hasfship && ostatus === fship.status && oid.equals(fship._id)) {
          steps[1] = Promise.resolve(fship);
        }
        // Otherwise update it
        else if (hasfship) {
            steps[1] = updateFriendship(m1, m2, fship);
          }
          // Or push a new one if it did not exist prior
          else {
              steps[1] = createFriendship(m1, m2, fship);
            }

        return Promise.all(steps).then(function (results) {
          return {
            friend: results[0],
            friender: results[1]
          };
        });
      });
    };

    /**
     * Create a friend request
     *
     * @param {Model} friend The potential friend being requested
     * @returns {Promise}
     */
    schema.methods.requestFriend = function (friend) {
      return this.constructor.requestFriend(this, friend);
    };

    /**
     * Get all friends of a model
     *
     * @param {Model|ObjectId|HexId} model doc or _id to query friends of
     * @param {Object} conditions, fields, options
     * @returns {Promise}
     * @see <a href="http://mongoosejs.com/docs/api.html#model_Model.find">Mongoose Model.find</a>
     */
    schema.statics.getFriends = function (model) {
      var _ref3 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          _ref3$conditions = _ref3.conditions,
          conditions = _ref3$conditions === undefined ? {} : _ref3$conditions,
          fields = _ref3.fields,
          options = _ref3.options;

      var Model = this;

      model = model._id || model;

      conditions[pathName + '._id'] = model;

      // "accepted" status is mirrored on both sides, but if querying
      // for "pending" or "requested" friends, the query must be reversed
      if (conditions[pathName + '.status']) {
        switch (conditions[pathName + '.status']) {
          case Status.Pending:
            conditions[pathName + '.status'] = Status.Requested;
            break;
          case Status.Requested:
            conditions[pathName + '.status'] = Status.Pending;
            break;
        }
      }

      // Wrap the conditions found for the friends path into an object which
      // will be passed as an $elemMatch.  This is necessary because when
      // specifying multiple conditions for an embedded array path, those
      // conditions may be satisfied by separate embedded documents.  For
      // example, `u1.getAcceptedFriends` would return all friends for `u1`
      // who had accepted friendships from ANY user, not just `u1`.
      //
      // See http://docs.mongodb.org/manual/tutorial/query-documents/#id4
      //
      var regex = new RegExp(pathName + '\\.(.+)$');

      var elemMatch = Object.keys(conditions).reduce(function (obj, key) {
        var match = key.match(regex);

        if (match) {
          obj[match[1]] = conditions[key];
          delete conditions[key];
        }

        return obj;
      }, {});

      conditions[pathName] = { '$elemMatch': elemMatch };

      // query remote friends based on the arguments
      var getFriends = Model.find(conditions, fields, options);

      // Reduce local friend docs to map which will be populated and
      // then combined with the queried remote friends to generate the
      // resulting array
      var getLocals = Model.findOne({ _id: model }, _defineProperty({}, pathName, 1)).then(function (doc) {
        if (!doc) {
          return [];
        }

        return doc[pathName].reduce(function (obj, friend) {
          obj[friend._id] = friend.toObject();
          return obj;
        }, {});
      });

      var wrapResultsWithStatus = function wrapResultsWithStatus(friends, locals) {
        return friends.reduce(function (results, friend) {
          if (locals[friend._id]) {
            results.push(_extends({}, locals[friend._id], {
              friend: friend
            }));
          }
          return results;
        }, []);
      };

      return Promise.all([getFriends, getLocals]).then(function (_ref4) {
        var _ref5 = _slicedToArray(_ref4, 2),
            friends = _ref5[0],
            locals = _ref5[1];

        return wrapResultsWithStatus(friends, locals);
      });
    };

    /**
     * Get all friends of this model
     *
     * @param {Object} conditions, fields, options
     * @returns {Promise}
     */
    schema.methods.getFriends = function () {
      var _ref6 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          conditions = _ref6.conditions,
          fields = _ref6.fields,
          options = _ref6.options;

      return this.constructor.getFriends(this, { conditions: conditions, fields: fields, options: options });
    };

    var getByStatus = function getByStatus(status) {
      return function (model) {
        var _ref7 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
            _ref7$conditions = _ref7.conditions,
            conditions = _ref7$conditions === undefined ? {} : _ref7$conditions,
            fields = _ref7.fields,
            options = _ref7.options;

        conditions[pathName + '.status'] = status;
        return this.getFriends(model, { conditions: conditions, fields: fields, options: options });
      };
    };

    /**
     * Get all pending friends for a given model
     *
     * @param {Model} user doc
     * @returns {Promise}
     */
    schema.statics.getPendingFriends = getByStatus(Status.Pending);

    /**
     * Get all pending friends for this model
     *
     * @param {Object} conditions, fields, options
     * @returns {Promise}
     */
    schema.methods.getPendingFriends = function () {
      var _ref8 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          conditions = _ref8.conditions,
          fields = _ref8.fields,
          options = _ref8.options;

      return this.constructor.getPendingFriends(this, { conditions: conditions, fields: fields, options: options });
    };

    /**
     * Get all accepted friends for a given model
     *
     * @param {Model} user doc
     * @returns {Promise}
     */
    schema.statics.getAcceptedFriends = getByStatus(Status.Accepted);

    /**
     * Get all accepted friends for this model
     *
     * @param {Object} conditions, fields, options
     * @returns {Promise}
     */
    schema.methods.getAcceptedFriends = function () {
      var _ref9 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          conditions = _ref9.conditions,
          fields = _ref9.fields,
          options = _ref9.options;

      return this.constructor.getAcceptedFriends(this, { conditions: conditions, fields: fields, options: options });
    };

    /**
     * Get all requested friends for a given model
     *
     * @param {Model} user doc
     * @returns {Promise}
     */
    schema.statics.getRequestedFriends = getByStatus(Status.Requested);

    /**
     * Get all requested friends for this model
     *
     * @param {Object} conditions, fields, options
     * @returns {Promise}
     */
    schema.methods.getRequestedFriends = function () {
      var _ref10 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          conditions = _ref10.conditions,
          fields = _ref10.fields,
          options = _ref10.options;

      return this.constructor.getRequestedFriends(this, { conditions: conditions, fields: fields, options: options });
    };

    /**
     * Check whether there is an established friendship between two users
     *
     * @param {Model} m1 the first model doc
     * @param {Model} m2 the second model doc
     * @returns {Promise}
     */
    schema.statics.areFriends = function (m1, m2) {
      m1 = m1._id || m1;
      m2 = m2._id || m2;

      return friendshipBetween(m1, m2, this).then(function (doc) {
        return Promise.resolve(!!doc && doc.status === Status.Accepted);
      }).catch(function () {
        return Promise.resolve(false);
      });
    };

    /**
     * Check whether there is an established friendship with a given user
     *
     * @param {Model} user doc
     * @returns {Promise}
     */
    schema.methods.isFriendsWith = function (user) {
      return this.constructor.areFriends(this, user);
    };

    /**
     * Remove a friendship between two friends
     *
     * @param {Model} m1 the first model doc
     * @param {Model} m2 the second model doc
     * @returns {Promise}
     */
    schema.statics.removeFriend = function (m1, m2) {
      var collection = this.collection;

      m1 = m1._id || m1;
      m2 = m2._id || m2;

      var pull = function pull(m1, m2) {
        return collection.update({ _id: m1 }, {
          $pull: _defineProperty({}, pathName, { _id: m2 })
        });
      };

      return Promise.all([pull(m1, m2), pull(m2, m1)]);
    };

    /**
     * Remove a friend of this model
     *
     * @param {Model} friend doc to remove
     * @returns {Promise}
     */
    schema.methods.removeFriend = function (model) {
      return this.constructor.removeFriend(this, model);
    };
  };
}

friendsPlugin.Status = Status;

friendsPlugin.Friendship = Friendship;