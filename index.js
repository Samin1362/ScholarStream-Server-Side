const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
require("dotenv").config();
const port = 3001;
const stripe = require("stripe")(process.env.STRIPE_SECRET);

//middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.l2cobj0.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("scholar_stream_db");
    const usersCollection = db.collection("users");
    const scholarshipCollection = db.collection("scholarships");
    const applicationsCollection = db.collection("applications");
    const reviewsCollections = db.collection("reviews");

    //users apis
    app.get("/users", async (req, res) => {
      const { email } = req.query;
      let query = {};

      if (email) {
        query = { email };
      }

      const cursor = usersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "student";
      user.createdAt = new Date();
      const result = usersCollection.insertOne(user);
      res.send(result);
    });

    //applications apis

    app.get("/applications", async (req, res) => {
      const { email } = req.query;
      let query = {};

      if (email) {
        query = { userEmail: email };
      }

      const cursor = applicationsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/applications/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await applicationsCollection.findOne(query);
      res.send(result);
    });

    app.delete("/applications/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await applicationsCollection.deleteOne(query);

      if (result.deletedCount === 1) {
        res.send({ success: true, message: "Application deleted" });
      } else {
        res
          .status(404)
          .send({ success: false, message: "Application not found." });
      }
    });

    app.post("/applications", async (req, res) => {
      const application = req.body;
      application.paymentStatus = "unpaid";
      application.enrollmentStatus = "pending";
      application.feedback = "";
      application.createdAt = new Date();
      const result = applicationsCollection.insertOne(application);
      res.send(result);
    });

    app.patch("/applications/:id", async (req, res) => {
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

      const result = await applicationsCollection.updateOne(query, {
        $set: updatedFields,
      });

      res.send(result);
    });

    app.patch("/applications/payment-done", async (req, res) => {
      const { id } = req.body;
      const query = { _id: new ObjectId(id) };

      const result = await applicationsCollection.updateOne(query, {
        $set: { paymentStatus: "paid" },
      });

      if (result.matchedCount === 0) {
        return res.status(404).send({ message: "Application not found" });
      }

      if (result.modifiedCount === 0) {
        return res.status(400).send({
          message: "Payment status already updated or no changes made",
        });
      }

      res.send({ message: "Payment status updated to paid", result });
    });

    //reviews apis
    app.get("/reviews", async (req, res) => {
      const { email } = req.query;
      let query = {};
      if (email) {
        query = { email: email };
      }

      const cursor = reviewsCollections.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/reviews", async (req, res) => {
      const review = req.body;
      review.createdAt = new Date();
      const result = await reviewsCollections.insertOne(review);
      res.send(result);
    });

    app.delete("/reviews/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await reviewsCollections.deleteOne(query);
      if (result.deletedCount === 1) {
        res.send({ success: true, message: "Review Deleted" });
      } else {
        res.status(404).send({ success: false, message: "Review not found." });
      }
    });

    app.patch("/reviews/:id", async (req, res) => {
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

      const result = await reviewsCollections.updateOne(query, {
        $set: updatedField,
      });

      res.send(result);
    });

    //scholarship apis
    app.get("/scholarships", async (req, res) => {
      const { email } = req.query;
      let query = {};

      if (email) {
        query = { "studentsApplied.email": email };
      }

      const cursor = scholarshipCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/scholarships/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await scholarshipCollection.findOne(query);
      res.send(result);
    });

    app.post("/scholarships", async (req, res) => {
      const scholarship = req.body;
      scholarship.createdAt = new Date();
      const result = await scholarshipCollection.insertOne(scholarship);
      res.send(result);
    });

    app.delete("/scholarships/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };

      const result = await scholarshipCollection.deleteOne(query);

      if (result.deletedCount === 1) {
        res.send({ success: true, message: "Scholarship Deleted." });
      } else {
        res
          .status(404)
          .send({ success: false, message: "Scholarship not found." });
      }
    });

    app.patch("/scholarships/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const { scholarshipName, universityName, image, country, city, degree, scholarshipCategory, subjectCategory, worldRank, tuitionFees, applicationFee } = req.body;

      const updatedFields = {};

      if(scholarshipName) {
        updatedFields.scholarshipName = scholarshipName;
      }

      if(universityName) {
        updatedFields.universityName = universityName;
      }

      if(image) {
        updatedFields.image = image;
      }

      if(country) {
        updatedFields.country = country;
      }

      if(city) {
        updatedFields.city = city;
      }

      if(degree) {
        updatedFields.degree = degree;
      }

      if(scholarshipCategory) {
        updatedFields.scholarshipCategory = scholarshipCategory;
      }

      if(subjectCategory) {
        updatedFields.subjectCategory = subjectCategory;
      }

      if(worldRank) {
        updatedFields.worldRank = worldRank;
      }

      if(tuitionFees) {
        updatedFields.tuitionFees = tuitionFees;
      }

      if(applicationFee) {
        updatedFields.applicationFee = applicationFee;
      }

      const result = await scholarshipCollection.updateOne(query, {
        $set: updatedFields,
      })

      res.send(result);

    });

    //payment related apis
    app.post("/create-checkout-sessions", async (req, res) => {
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
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
