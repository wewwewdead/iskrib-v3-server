import express from "express";
import cors from 'cors';
import router from "./routes/routes.js";

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
    origin: ['https://iskrib.com', 'https://iskrib-v3-client-side.onrender.com', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 60 * 60 * 24
};

app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.use('/api', router);
// Keep legacy root routes available while clients migrate to /api.
app.use(router)

app.get('/', (req, res) => {
    res.send(`hello from backend port ${PORT}`)
})
app.listen(PORT, () =>{
    console.log(`server is running at port${PORT}`)
})
