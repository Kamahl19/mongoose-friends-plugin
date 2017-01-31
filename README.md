mongoose-friends-plugin [![Build Status](https://travis-ci.org/Kamahl19/mongoose-friends-plugin.svg?branch=master)](https://travis-ci.org/Kamahl19/mongoose-friends-plugin)
===

2-way friendship relationship plugin for Mongoose ODM (initially forked from [numbers1311407/mongoose-friends](https://github.com/numbers1311407/mongoose-friends))


Installation
---

    npm i -S mongoose-friends-plugin


Description and usage
---

Easily add "friendships" to your Mongoose user Model through a simple
plugin.  The friendships are stored in a sub-document array on the model
doc without the need for a separate collection.

At first, make sure your mongoose is using [promise](http://mongoosejs.com/docs/promises.html)

    mongoose.Promise = global.Promise;

Then include the plugin in the schema definition:

    const friendsPlugin = require('mongoose-friends-plugin');
    const schema = new mongoose.Schema({ ... });

    // optionally specify a name for the path (default is "friends")
    // optionally specify select option for collection of friendships (specifies default projections for queries)
    schema.plugin(friendsPlugin({ pathName: 'myCustomPath', select: true }));

    const User = mongoose.model('User', schema);


Initiate a friend request via the `requestFriend` method:

    User.requestFriend(user1._id, user2._id)
      .then(() => console.log('Request sent'));

The two users now share a friendship, with different statuses: "requested"
and "pending", respectively.

    User.getFriends(user1)
      .then((friendships) => {
        console.log(friendships); // [{ status: 'requested', added: <Date added>, friend: user2 }]
      });

    User.getFriends(user2)
      .then((friendships) => {
        console.log(friendships); // [{ status: 'pending', added: <Date added>, friend: user1 }]
      });

To accept, just reciprocate the request:

    User.requestFriend(user2._id, user1._id)
      .then(() => console.log('Request accepted'));

The two users are now friends:

    User.getFriends(user1)
      .then((friendships) => {
        console.log(friendships); // [{ status: 'accepted', added: <Date added>, friend: user2 }]
      });

    User.getFriends(user2)
      .then((friendships) => {
        console.log(friendships); // [{ status: 'accepted', added: <Date added>, friend: user1 }]
      });

To remove a friendship at any point in the process, just:

    User.removeFriend(user1, user2)
      .then(() => console.log('Friendship removed'));
    // or vice-versa
    User.removeFriend(user2, user1)
      .then(() => console.log('Friendship removed'));

All the static methods have instance variants:

    user.getFriends(options).then((friends) => console.log(friends));
    user.requestFriend(otheruser).then(() => ...);
    user.removeFriend(badfriend).then(() => ...);

Retrieving friends
---

`getFriends` is the interface to retrieve friends for a user. It sits on
top of the normal Mongoose `find` API and has **similar** signature with 3 exceptions:
the first argument is a model (or the id of a model) that
you're querying for, `conditions`, `select` and `options` are properties of an object
and there is no callback (use promise instead).
This means you can pass along field selects, sorts limits, etc.

    // the signature
    User.getFriends(user, { conditions, select, options })
      .then((friends) => ...);

For example to find only friends whose names start with "Bo" you could:

    User.getFriends(user, {name: /^Bo/});

To select only the name field you might:

    User.getFriends(user, {}, {name: 1});

Or to sort by user name you might:

    User.getFriends(user, {}, null, { sort: { name: 1 } });

Friendships of different statuses can be queried in this manner:

    // get the pending friendships for a user (given that the pathname
    // for the friends array is left the default, "friends")
    const Status = require('mongoose-friends-plugin').Status;
    User.getFriends(user, { 'friends.status': Status.Pending });

... but for convenience purposes they can also be retrieved through
provided convenience methods:

    User.getPendingFriends;
    User.getAcceptedFriends;
    User.getRequestedFriends;
    // with instance method versions provided for each

The callback return value of `getFriends` is an array of friends, wrapped
with the friendship metadata for the given user, like:

    [{
      // One of pending|accepted|requested where:
      //
      // pending: received, but not yet accepted
      // requested: sent, but not yet accepted by other party
      // accepted: accepted by both parties
      status: 'accepted',

      // The date the friendship request was first *created* (NOT accepted)
      added: <the date added>,

      // The remote friend doc, fields filtered by any passed field select,
      // sorted by any passed sort, etc.
      friend: <the friend doc>
    }]

### Gotchas

The bare-metal nature of how `.getFriends` sits atop of `Model.find` might
encourage one to simply circumvent it entirely and use `Model.find` directly.

This is of course acceptable, but a few things should be noted.  When querying
for friends with a given status with `.getFriends`, the status is actually
***reversed*** in the query.  This makes sense when considering how friendships
are stored and queried.  If you're looking for the "requested" friendships of
user A, you're actually looking for all "pending" friendships that other users
have with user A.

`.getFriends` makes this transparent, and furthermore, it does not even return
the friends data of the docs it queries.  Rather it queries *on* the friends
data, then maps the metadata of the friendships for the user in question on the
results.  This means that the `friends` field is actually unselected by default
and not returned.  Essentially the process is:

1. Find friends of user, not including their friendships
2. Retrieve the user, including their friendships
3. Map the user's friendship metadata for each found friend onto the result

Indexing
---

By default, the plugin will add a multikey index on the friends array.
If you do not want this behavior for whatever reason, just pass
`index: false` to the plugin options, like:

    schema.plugin(friends({ index: false }));
