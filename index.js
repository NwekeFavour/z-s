const express = require('express')
const app = express()
const cors = require("cors")
const dotenv = require("dotenv")
const port =5000 || process.env.PORT
app.set("trust proxy", 1);
const rateLimit = require("express-rate-limit");
dotenv.config();
     
app.use(cors({
  origin: ["http://localhost:5173", "https://zmarket-three.vercel.app"], // allow all origins, or replace "*" with your frontend URL
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));     
app.use(express.json());
const cartRoutes = require('./routes/cartRoutes');
const productRoutes = require("./routes/productRoutes")
const db = require('./db');
const userRoutes = require("./routes/userRoutes")
const statsRoutes = require('./routes/statsRoute');
const orderRoutes = require("./routes/orderRoutes")

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // max 10 login attempts per 15 min
  message: "Too many login attempts, try again later.",
});

app.use('/api/cart', cartRoutes); // Use cart routes
app.use('/api/auth', authLimiter, userRoutes); // use user routes
app.use('/api',  statsRoutes); // user stats routes
app.use('/api/products', productRoutes); // use product routes
app.use('/api/orders', orderRoutes);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
 
app.get('/test-db', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT NOW()'); // simple query
    res.json({ message: 'Database connected!', time: rows[0].now });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Database connection failed' });
  }   
});
              
app.get("/", (req,res) => {
res.send("The server is running")
})  


app.listen(port, ()=>{
console.log(`Server is running on port: http://localhost:${port}`)
})

  