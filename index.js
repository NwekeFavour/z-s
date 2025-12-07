const express = require('express')
const app = express()
const cors = require("cors")
const dotenv = require("dotenv")
const port =5000 || process.env.PORT
app.set("trust proxy", 1);
const helmet = require("helmet")
const rateLimit = require("express-rate-limit");
dotenv.config();
     
app.use(cors({
  origin: ["http://localhost:5173", "https://zmarket-three.vercel.app", "https://zandmarket.co.uk", "https://www.zandmarket.co.uk"], // allow all origins, or replace "*" with your frontend URL
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
})); 

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // max 100 login attempts per 15 min
  message: "Too many login attempts, try again later.",
});

const { stripeWebhook } = require('./controllers/orderControllers')
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

app.use(helmet());
app.use(rateLimit({ windowMs: 15*60*1000, max: 200 }));
app.use(express.json());
const cartRoutes = require('./routes/cartRoutes');
const productRoutes = require("./routes/productRoutes")
const db = require('./db');
const userRoutes = require("./routes/userRoutes")
const statsRoutes = require('./routes/statsRoute');
const notifyRoutes = require("./routes/notifyRoutes")
const orderRoutes = require("./routes/orderRoutes") 
 
  
app.use('/api/cart', cartRoutes); // Use cart routes
app.use('/api/auth', authLimiter, userRoutes); // use user routes
app.use('/api',  statsRoutes); // user stats routes
app.use('/api/products', productRoutes); // use product routes
app.use('/api/orders', orderRoutes);
app.use('/api/notifications', notifyRoutes)
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

  