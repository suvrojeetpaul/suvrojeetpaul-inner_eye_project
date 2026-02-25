import flwr as fl

# Start Flower server for 3 rounds of federated learning
if __name__ == "__main__":
    print("--- INNER EYE CENTRAL AGGREGATOR STARTING ---")
    fl.server.start_server(
        server_address="0.0.0.0:8080",
        config=fl.server.ServerConfig(num_rounds=3),
    )