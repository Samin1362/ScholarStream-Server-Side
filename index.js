const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);

// const serviceAccount = require("./scholarstream-firebase-project-firebase-adminsdk-fbsvc-c4f28a2b73.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

//middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized token" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.l2cobj0.mongodb.net/?appName=Cluster0`;

// Cache for MongoDB connection (for serverless)
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  // Return cached connection if available and connected
  if (cachedClient && cachedDb) {
    try {
      // Check if connection is still alive
      await cachedClient.db("admin").command({ ping: 1 });
      return { client: cachedClient, db: cachedDb };
    } catch (error) {
      // Connection is dead, reset cache
      cachedClient = null;
      cachedDb = null;
    }
  }

  // Create new connection
  try {
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

    await client.connect();
    const db = client.db("scholar_stream_db");

    // Cache the connection
    cachedClient = client;
    cachedDb = db;

    return { client: cachedClient, db: cachedDb };
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

// Helper function to get collections
async function getCollections() {
  const { db } = await connectToDatabase();
  return {
    usersCollection: db.collection("users"),
    scholarshipCollection: db.collection("scholarships"),
    applicationsCollection: db.collection("applications"),
    reviewsCollections: db.collection("reviews"),
  };
}

//middleware with database access
const verifyAdmin = async (req, res, next) => {
  try {
    const email = req.decoded_email;
    const { usersCollection } = await getCollections();
    const query = { email: email };
    const user = await usersCollection.findOne(query);

    if (!user || user.role !== "admin") {
      return res.status(403).send({ message: "Forbidden access" });
    }

    next();
  } catch (error) {
    console.error("Error verifying admin:", error);
    return res.status(500).send({ message: "Internal server error" });
  }
};

const verifyModerator = async (req, res, next) => {
  try {
    const email = req.decoded_email;
    const { usersCollection } = await getCollections();
    const query = { email: email };
    const user = await usersCollection.findOne(query);

    if (!user || user.role !== "moderator") {
      return res.status(403).send({ message: "Forbidden access" });
    }

    next();
  } catch (error) {
    console.error("Error verifying moderator:", error);
    return res.status(500).send({ message: "Internal server error" });
  }
};

//users apis
app.get("/users", verifyFBToken, async (req, res) => {
  try {
    const { email } = req.query;
    let query = {};

    if (email) {
      query = { email };
    }

    const { usersCollection } = await getCollections();
    const cursor = usersCollection.find(query);
    const result = await cursor.toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.get("/users/:email/role", async (req, res) => {
  try {
    const { email } = req.params;
    const query = { email: email };
    const { usersCollection } = await getCollections();
    const user = await usersCollection.findOne(query);
    res.send({ role: user?.role });
  } catch (error) {
    console.error("Error fetching user role:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    user.role = "student";
    user.createdAt = new Date();
    const { usersCollection } = await getCollections();
    const result = await usersCollection.insertOne(user);
    res.send(result);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.delete("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const { usersCollection } = await getCollections();

    // First, get the user to retrieve their email
    const user = await usersCollection.findOne(query);

    if (!user) {
      return res
        .status(404)
        .send({ success: false, message: "User not found." });
    }

    const userEmail = user.email;

    // Delete from MongoDB
    const result = await usersCollection.deleteOne(query);

    if (result.deletedCount === 1) {
      // Delete from Firebase Auth using email
      try {
        const firebaseUser = await admin.auth().getUserByEmail(userEmail);
        await admin.auth().deleteUser(firebaseUser.uid);
      } catch (firebaseError) {
        // If Firebase user doesn't exist or error occurs, log it but don't fail the request
        console.error("Error deleting user from Firebase:", firebaseError);
        // Continue with success response since MongoDB deletion succeeded
      }

      res.send({
        success: true,
        message: "User deleted from database and Firebase.",
        result,
      });
    } else {
      res.status(404).send({ success: false, message: "User not found." });
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send({
      success: false,
      message: "Error deleting user.",
      error: error.message,
    });
  }
});

app.patch("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const { role } = req.body;

    const updatedField = { role };
    const { usersCollection } = await getCollections();

    const result = await usersCollection.updateOne(query, {
      $set: updatedField,
    });

    res.send(result);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

//applications apis

app.get("/applications", async (req, res) => {
  try {
    const { email } = req.query;
    let query = {};

    if (email) {
      query = { userEmail: email };
    }

    const { applicationsCollection } = await getCollections();
    const cursor = applicationsCollection.find(query);
    const result = await cursor.toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.get("/applications/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const { applicationsCollection } = await getCollections();
    const result = await applicationsCollection.findOne(query);
    res.send(result);
  } catch (error) {
    console.error("Error fetching application:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.delete("/applications/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const { applicationsCollection } = await getCollections();
    const result = await applicationsCollection.deleteOne(query);

    if (result.deletedCount === 1) {
      res.send({ success: true, message: "Application deleted" });
    } else {
      res
        .status(404)
        .send({ success: false, message: "Application not found." });
    }
  } catch (error) {
    console.error("Error deleting application:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.post("/applications", verifyFBToken, async (req, res) => {
  try {
    const application = req.body;
    application.paymentStatus = "unpaid";
    application.enrollmentStatus = "pending";
    application.feedback = "";
    application.createdAt = new Date();
    const { applicationsCollection } = await getCollections();
    const result = await applicationsCollection.insertOne(application);
    res.send(result);
  } catch (error) {
    console.error("Error creating application:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.patch(
  "/applications/:id",
  verifyFBToken,
  verifyModerator,
  async (req, res) => {
    try {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const { feedback, enrollmentStatus } = req.body;

      const updatedFields = {};

      if (feedback) {
        updatedFields.feedback = feedback;
      }

      if (enrollmentStatus) {
        updatedFields.enrollmentStatus = enrollmentStatus;
      }

      if (Object.keys(updatedFields).length === 0) {
        return res.status(400).send({ message: "No valid fields provided" });
      }

      const { applicationsCollection } = await getCollections();
      const result = await applicationsCollection.updateOne(query, {
        $set: updatedFields,
      });

      res.send(result);
    } catch (error) {
      console.error("Error updating application:", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

app.patch("/applications/payment-done/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;

    console.log(id);

    if (!id) {
      return res.status(400).send({ message: "ID is required" });
    }

    const query = { _id: new ObjectId(id) };
    const { applicationsCollection } = await getCollections();

    const result = await applicationsCollection.updateOne(query, {
      $set: { paymentStatus: "paid" },
    });

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Application not found" });
    }

    if (result.modifiedCount === 0) {
      return res
        .status(400)
        .send({ message: "Payment status already updated" });
    }

    res.send({ success: true, message: "Payment status updated to paid" });
  } catch (error) {
    console.error("Error updating payment status:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

//reviews apis
app.get("/reviews", async (req, res) => {
  try {
    const { email } = req.query;
    let query = {};
    if (email) {
      query = { email: email };
    }

    const { reviewsCollections } = await getCollections();
    const cursor = reviewsCollections.find(query);
    const result = await cursor.toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.post("/reviews", verifyFBToken, async (req, res) => {
  try {
    const review = req.body;
    review.createdAt = new Date();
    const { reviewsCollections } = await getCollections();
    const result = await reviewsCollections.insertOne(review);
    res.send(result);
  } catch (error) {
    console.error("Error creating review:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.delete("/reviews/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const { reviewsCollections } = await getCollections();
    const result = await reviewsCollections.deleteOne(query);
    if (result.deletedCount === 1) {
      res.send({ success: true, message: "Review Deleted" });
    } else {
      res.status(404).send({ success: false, message: "Review not found." });
    }
  } catch (error) {
    console.error("Error deleting review:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.patch("/reviews/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const { ratingPoint, reviewComment } = req.body;

    const updatedField = {};

    if (ratingPoint !== undefined) {
      updatedField.ratingPoint = ratingPoint;
    }

    if (reviewComment !== undefined) {
      updatedField.reviewComment = reviewComment;
    }

    if (Object.keys(updatedField).length === 0) {
      return res.status(400).send({ message: "No valid fields provided" });
    }

    const { reviewsCollections } = await getCollections();
    const result = await reviewsCollections.updateOne(query, {
      $set: updatedField,
    });

    res.send(result);
  } catch (error) {
    console.error("Error updating review:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

//scholarship apis
app.get("/scholarships", async (req, res) => {
  try {
    const { email, search, country } = req.query;
    let query = {};

    // Filter by student's applied scholarships (existing functionality)
    if (email) {
      query["studentsApplied.email"] = email;
    }

    // Filter by country
    if (country) {
      query.country = country;
    }

    // Search by scholarshipName, universityName, or degree
    if (search) {
      query.$or = [
        { scholarshipName: { $regex: search, $options: "i" } },
        { universityName: { $regex: search, $options: "i" } },
        { degree: { $regex: search, $options: "i" } },
      ];
    }

    const { scholarshipCollection } = await getCollections();
    const cursor = scholarshipCollection.find(query);
    const result = await cursor.toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching scholarships:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.get("/scholarships/:id", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const { scholarshipCollection } = await getCollections();
    const result = await scholarshipCollection.findOne(query);
    res.send(result);
  } catch (error) {
    console.error("Error fetching scholarship:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.post("/scholarships", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const scholarship = req.body;
    scholarship.createdAt = new Date();
    const { scholarshipCollection } = await getCollections();
    const result = await scholarshipCollection.insertOne(scholarship);
    res.send(result);
  } catch (error) {
    console.error("Error creating scholarship:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.delete(
  "/scholarships/:id",
  verifyFBToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const { scholarshipCollection } = await getCollections();

      const result = await scholarshipCollection.deleteOne(query);

      if (result.deletedCount === 1) {
        res.send({ success: true, message: "Scholarship Deleted." });
      } else {
        res
          .status(404)
          .send({ success: false, message: "Scholarship not found." });
      }
    } catch (error) {
      console.error("Error deleting scholarship:", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

app.patch("/scholarships/:id", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const {
      scholarshipName,
      universityName,
      image,
      country,
      city,
      degree,
      scholarshipCategory,
      subjectCategory,
      worldRank,
      tuitionFees,
      applicationFee,
    } = req.body;

    const updatedFields = {};

    if (scholarshipName) {
      updatedFields.scholarshipName = scholarshipName;
    }

    if (universityName) {
      updatedFields.universityName = universityName;
    }

    if (image) {
      updatedFields.image = image;
    }

    if (country) {
      updatedFields.country = country;
    }

    if (city) {
      updatedFields.city = city;
    }

    if (degree) {
      updatedFields.degree = degree;
    }

    if (scholarshipCategory) {
      updatedFields.scholarshipCategory = scholarshipCategory;
    }

    if (subjectCategory) {
      updatedFields.subjectCategory = subjectCategory;
    }

    if (worldRank) {
      updatedFields.worldRank = worldRank;
    }

    if (tuitionFees) {
      updatedFields.tuitionFees = tuitionFees;
    }

    if (applicationFee) {
      updatedFields.applicationFee = applicationFee;
    }

    const { scholarshipCollection } = await getCollections();
    const result = await scholarshipCollection.updateOne(query, {
      $set: updatedFields,
    });

    res.send(result);
  } catch (error) {
    console.error("Error updating scholarship:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

//payment related apis
app.post("/create-checkout-sessions", verifyFBToken, async (req, res) => {
  try {
    const paymentInfo = req.body;
    const amount = parseInt(paymentInfo.applicationFee) * 100;
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "USD",
            unit_amount: amount,
            product_data: {
              name: paymentInfo.scholarshipName,
            },
          },
          quantity: 1,
        },
      ],
      customer_email: paymentInfo.email,
      metadata: {
        applicationId: paymentInfo.id,
      },
      mode: "payment",
      success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success/${paymentInfo.id}`,
      cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    });

    console.log(session);
    res.send({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Export the app for Vercel serverless
module.exports = app;

// For local development, start the server
if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}
