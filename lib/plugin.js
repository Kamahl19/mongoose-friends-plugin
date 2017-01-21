const async = require('async');

const Status = {
  Pending: 'pending',
  Accepted: 'accepted',
  Requested: 'requested',
};

const Friendship = {
  status: { type: String, enum: Object.values(Status) },
  added: { type: Date },
  added: Date,
};

const defaultOptions = {
  pathName: 'friends',
  doIndex: true,
};

module.exports = friendsPlugin;

function friendsPlugin(options) {
  const { pathName, doIndex } = {
    ...defaultOptions,
    ...options,
  };

  // Fields to add to the extending model
  const fields = {
    [pathName]: { type: [Friendship], select: false },
  };

  /**
   * The work function which pushes or updates embedded friend objects
   * for two documents, returns a function
   *
   * @api private
   */
  const _update = function(query, update, fship) {
    return function(done) {
      this.findOneAndUpdate(query, update, { new: false }, (err) => done(err, fship));
    };
    }

  /**
   * Return a function to update a friendship between two parties
   *
   * @api private
   */
  const updateFriendship = function(m1, m2, fship) {
    const query = {
      _id: m1,
      [pathName]: { $elemMatch: { _id: m2 } },
    };

    const updater = {
      $set: {
        [`${pathName}.$.status`]: fship.status,
      },
    };

    return _update(query, updater, fship);
  }

  /**
   * Return a function to create a new friendship between two parties
   *
   * @api private
   */
  const pushFriendship = function(m1, m2, fship) {
    const query = {
      _id: m1,
    };

    fship.added = new Date();

    const updater = {
      $push: {
        [pathName]: fship,
      },
    };

    return _update(query, updater, fship);
  }

  /**
   * Generate a function to return one side of a friendship between
   * two models
   *
   * @param Model the extending model
   * @param m1 the model or model _id being queried
   * @param m2 the model or model _id whose friendship is queried for
   *
   * @returns a function which will call back with an friendship for m2 on m1
   * @api private
   */
  const friendshipBetween = function(m1, m2) {
    const proj = {
      [pathName]: { $elemMatch: { _id: m2 } },
    };

    return function(done) {
      this.findById(m1, proj)
        .then((doc) => {
        if (!doc) {
          return done('friendship not found');
        }

        done(null, doc[pathName][0]);
        })
        .catch((err) => done(err));
    };
    }

  return function friends(schema) {
    // add the embedded friends
    schema.add(fields);

    // Index the friends array with a multikey index on _id.  Further indexing
    // on status is probably unnecessary, as all queries will hit _id and
    // this will already limit them to the friends on an individual user.
    if (doIndex) {
      const index = {
        [`${pathName}._id`]: 1,
      };

      schema.index(index, { name: 'friendsplugin' });
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
    schema.statics.requestFriend = function(m1, m2) {
      return new Promise((resolve, reject) => {
        const steps = {};
        const Model = this;

        m1 = m1._id || m1;
        m2 = m2._id || m2;

        async.auto({
          m1: friendshipBetween(m1, m2).bind(this),
          m2: friendshipBetween(m2, m1).bind(this),
        }, (err, o) => {
          if (err) {
              return reject(err);
          }

          const hasfship = !!o.m1;
          const fship = o.m1 || { _id: m2 };
          const oid = fship._id;
          const ostatus = fship.status;

          // m2 has no friendship, add a new pending friendship, mark
          // m1's status as requested
          if (!o.m2) {
            fship.status = Status.Requested;

            steps.friend = pushFriendship(m2, m1, {
              _id: m1,
              status: Status.Pending
            }).bind(Model);
          }
          else {
            switch (o.m2.status) {
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
                steps.friend = updateFriendship(m2, m1, {
                  status: Status.Accepted
                }).bind(Model);
                break;
            }
          }

          // If no update was necessary, send the remote friendship back directly
          if (!steps.friend) {
            steps.friend = function(done) {
              done(null, o.m2)
            };
          }

          // If no update was necessary, send the local friendship back directly
          if (hasfship && ostatus === fship.status && oid.equals(fship._id)) {
            steps.friender = function(done) {
              done(null, fship)
            }
          }
          // Otherwise update it
          else if (hasfship) {
              steps.friender = updateFriendship(m1, m2, fship).bind(Model)
          }
          // Or push a new one if it did not exist prior
          else {
              steps.friender = pushFriendship(m1, m2, fship).bind(Model)
          }

          async.parallel(steps, (err, results) => {
            if (err) {
              return reject(err);
            }

            resolve(results);
          });
        });
      });
    };

    /**
     * Create a friend request
     *
     * @param {Model} friend The potential friend being requested
     * @returns {Promise}
     */
    schema.methods.requestFriend = function(friend) {
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
    schema.statics.getFriends = function(model, { conditions = {}, fields, options } = {}) {
      return new Promise((resolve, reject) => {
        const Model = this;
        const op = 'find';

        model = model._id || model;

        conditions[`${pathName}._id`] = model;

        // "accepted" status is mirrored on both sides, but if querying
        // for "pending" or "requested" friends, the query must be reversed
        if (conditions[`${pathName}.status`]) {
          switch (conditions[`${pathName}.status`]) {
            case Status.Pending:
              conditions[`${pathName}.status`] = Status.Requested;
              break;
            case Status.Requested:
              conditions[`${pathName}.status`] = Status.Pending;
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
        const rx = new RegExp(`${pathName}\\.(.+)$`);

        const elemMatch = Object.keys(conditions).reduce((o, k) => {
          let match;

          if (match = k.match(rx)) {
            o[match[1]] = conditions[k];
            delete conditions[k];
          }

          return o;
        }, {});

        conditions[pathName] = { '$elemMatch': elemMatch };

        async.parallel({
          // query remote friends based on the arguments
          friends: function(done) {
            Model[op](conditions, fields, options, done);
          },

          // Reduce local friend docs to map which will be populated and
          // then combined with the queried remote friends to generate the
          // resulting array
          locals: function(done) {
            const select = {
              [pathName]: 1,
            };

            Model.findOne({ _id: model }, select, (err, doc) => {
              if (err) {
                return done(err);
              }

              if (!doc) {
                return done(null, []);
              }

              done(null, doc[pathName].reduce((o, friend) => {
                o[friend._id] = friend.toObject();
                return o;
              }, {}));
            });
          }
        }, function(err, res) {
          if (err) {
            return reject(err);
          }

          // wrap the results with the status
          for (let i = 0, friendship; i < res.friends.length; i++) {
            friendship = res.locals[res.friends[i]._id];

            if (!friendship) {
              continue;
            }

            friendship.friend = res.friends[i];
            res.friends[i] = friendship;
          }

          resolve(res.friends);
        });
      });
    };

    /**
     * Get all friends of this model
     *
     * @param {Object} conditions, fields, options
     * @returns {Promise}
     */
    schema.methods.getFriends = function({ conditions, fields, options } = {}) {
      return this.constructor.getFriends(this, { conditions, fields, options });
    };

    const getByStatus = function(status) {
      return function(model, { conditions = {}, fields, options } = {}) {
        conditions[`${pathName}.status`] = status;
        return this.getFriends(model, { conditions, fields, options });
      }
    }

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
    schema.methods.getPendingFriends = function({ conditions, fields, options } = {}) {
      return this.constructor.getPendingFriends(this, { conditions, fields, options });
    }

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
    schema.methods.getAcceptedFriends = function({ conditions, fields, options } = {}) {
      return this.constructor.getAcceptedFriends(this, { conditions, fields, options });
    }

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
    schema.methods.getRequestedFriends = function({ conditions, fields, options } = {}) {
      return this.constructor.getRequestedFriends(this, { conditions, fields, options });
    }

    /**
     * Check whether there is an established friendship between two users
     *
     * @param {Model} m1 the first model doc
     * @param {Model} m2 the second model doc
     * @returns {Promise}
     */
    schema.statics.areFriends = function(m1, m2) {
      return new Promise((resolve) => {
        m1 = m1._id || m1;
        m2 = m2._id || m2;

        const getFriendship = friendshipBetween(m1, m2).bind(this);

        getFriendship(function(err, doc) {
          resolve(!err && !!doc && doc.status === Status.Accepted);
        });
      });
    }

    /**
     * Check whether there is an established friendship with a given user
     *
     * @param {Model} user doc
     * @returns {Promise}
     */
    schema.methods.isFriendsWith = function(user) {
      return this.constructor.areFriends(this, user);
    }

    /**
     * Remove a friendship between two friends
     *
     * @param {Model} m1 the first model doc
     * @param {Model} m2 the second model doc
     * @returns {Promise}
     */
    schema.statics.removeFriend = function(m1, m2) {
      return new Promise((resolve, reject) => {
        const collection = this.collection;

        m1 = m1._id || m1;
        m2 = m2._id || m2;

        const pull = function(m1, m2) {
          const update = {
            $pull: {
              [pathName]: { _id: m2 }
            }
          };

          return function(done) {
            collection.update({ _id: m1 }, update, done);
          }
        }

        async.parallel([
          pull(m1, m2),
          pull(m2, m1)
        ], (err, results) => {
          if (err) {
            return reject(err);
          }

          resolve(results);
        });
      });
    };

    /**
     * Remove a friend of this model
     *
     * @param {Model} friend doc to remove
     * @returns {Promise}
     */
    schema.methods.removeFriend = function(model) {
      return this.constructor.removeFriend(this, model);
    };
  };
}

friendsPlugin.Status = Status;

friendsPlugin.Friendship = Friendship;
