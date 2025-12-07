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

    //users apis
    app.get("/users", async (req, res) => {});

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "student";
      user.createdAt = new Date();
      const result = usersCollection.insertOne(user);
      res.send(result);
    });

    //scholarship apis
    app.get("/scholarships", async (req, res) => {
      const query = {};
      const cursor = scholarshipCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/scholarships/:id", async (req, res) => {
      const id = req.params.id;
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

    //payment related apis
    app.post("/create-checkout-sessions", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.tuitionFees) * 100;
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
          scholarshipId: paymentInfo.id,
        },
        mode: "payment",
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
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
