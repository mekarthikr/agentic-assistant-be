import { createApplicationServer } from "../src/application-server";

const { httpServer } = await createApplicationServer();

export default httpServer;
