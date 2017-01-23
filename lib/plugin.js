const Status = {
  Pending: 'pending',
  Accepted: 'accepted',
  Requested: 'requested',
};

const Friendship = {
  status: { type: String, enum: Object.values(Status) },
  added: { type: Date },
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
  const friendshipBetween = (m1, m2, that) => {
    return that.findById(m1, {
      [pathName]: { $elemMatch: { _id: m2 } },
    })
      .then((doc) => {
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
      schema.index({
        [`${pathName}._id`]: 1,
      }, {
        name: 'friendsplugin',
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
    schema.statics.requestFriend = function(m1, m2) {
      m1 = m1._id || m1;
      m2 = m2._id || m2;

      const updateFriendship = (m1, m2, fship) => {
        return this.findOneAndUpdate({
          _id: m1,
          [pathName]: { $elemMatch: { _id: m2 } },
        }, {
          $set: {
            [`${pathName}.$.status`]: fship.status,
          },
        }, { new: false })
          .then(() => fship);
      }

      const createFriendship = (m1, m2, fship) => {
        fship.added = new Date();

        return this.findOneAndUpdate({ _id: m1 }, {
          $push: {
            [pathName]: fship,
          },
        }, { new: false })
          .then(() => fship);
      };

      return Promise.all([
        friendshipBetween(m1, m2, this),
        friendshipBetween(m2, m1, this),
      ])
        .then(([m1Res, m2Res]) => {
          const hasfship = !!m1Res;
          const fship = m1Res || { _id: m2 };
          const oid = fship._id;
          const ostatus = fship.status;

          const steps = [];

          // m2 has no friendship, add a new pending friendship, mark
          // m1's status as requested
          if (!m2Res) {
            fship.status = Status.Requested;

            steps[0] = createFriendship(m2, m1, {
              _id: m1,
              status: Status.Pending
            });
          }
          else {
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

          return Promise.all(steps)
            .then((results) => ({
              friend: results[0],
              friender: results[1],
            }));
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
      const Model = this;

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
      const regex = new RegExp(`${pathName}\\.(.+)$`);

      const elemMatch = Object.keys(conditions).reduce((obj, key) => {
        const match = key.match(regex);

        if (match) {
          obj[match[1]] = conditions[key];
          delete conditions[key];
        }

        return obj;
      }, {});

      conditions[pathName] = { '$elemMatch': elemMatch };

      // query remote friends based on the arguments
      const getFriends = Model.find(conditions, fields, options);

      // Reduce local friend docs to map which will be populated and
      // then combined with the queried remote friends to generate the
      // resulting array
      const getLocals = Model.findOne({ _id: model }, { [pathName]: 1 })
        .then((doc) => {
          if (!doc) {
            return [];
          }

          return doc[pathName].reduce((obj, friend) => {
            obj[friend._id] = friend.toObject();
            return obj;
          }, {});
        });

      const wrapResultsWithStatus = (friends, locals) => {
        return friends.reduce((results, friend) => {
          if (locals[friend._id]) {
            results.push({
              ...locals[friend._id],
              friend
            });
          }
          return results;
        }, []);
      };

      return Promise.all([
        getFriends,
        getLocals,
      ])
        .then(([friends, locals]) => wrapResultsWithStatus(friends, locals));
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
      m1 = m1._id || m1;
      m2 = m2._id || m2;

      return friendshipBetween(m1, m2, this)
        .then((doc) => Promise.resolve(!!doc && doc.status === Status.Accepted))
        .catch((err) => Promise.resolve(false));
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
      const collection = this.collection;

      m1 = m1._id || m1;
      m2 = m2._id || m2;

      const pull = (m1, m2) => {
        return collection.update({ _id: m1 }, {
          $pull: {
            [pathName]: { _id: m2 }
          }
        });
      }

      return Promise.all([
        pull(m1, m2),
        pull(m2, m1),
      ]);
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
