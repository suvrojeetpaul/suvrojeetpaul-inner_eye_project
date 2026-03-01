import signal
import sys
import os

# --- WINDOWS COMPATIBILITY PATCH START ---
if sys.platform == "win32":
    if not hasattr(signal, 'SIGQUIT'):
        signal.SIGQUIT = signal.SIGBREAK
# --- WINDOWS COMPATIBILITY PATCH END ---

import flwr as fl
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from collections import OrderedDict

# Define a Simple Medical CNN (Must match what the server expects)
class MedicalNet(nn.Module):
    def __init__(self):
        super(MedicalNet, self).__init__()
        self.conv1 = nn.Conv2d(1, 32, 3) # 1 channel for Grayscale X-rays/MRI
        self.pool = nn.MaxPool2d(2, 2)
        self.fc1 = nn.Linear(32 * 13 * 13, 10) # Simplified for example

    def forward(self, x):
        x = self.pool(torch.relu(self.conv1(x)))
        x = torch.flatten(x, 1)
        x = self.fc1(x)
        return x

# Define the Flower Client
class HospitalClient(fl.client.NumPyClient):
    def __init__(self, model):
        self.model = model

    def get_parameters(self, config):
        return [val.cpu().numpy() for _, val in self.model.state_dict().items()]

    def set_parameters(self, parameters):
        params_dict = zip(self.model.state_dict().keys(), parameters)
        state_dict = OrderedDict({k: torch.tensor(v) for k, v in params_dict})
        self.model.load_state_dict(state_dict, strict=True)

    def fit(self, parameters, config):
        self.set_parameters(parameters)
        print("🏥 Local Training Started on Hospital Data...")
        # (In a real app, you'd run your optimizer here)
        return self.get_parameters(config={}), 10, {} # Return 10 as dummy data size

    def evaluate(self, parameters, config):
        self.set_parameters(parameters)
        print("🏥 Evaluating Global Model on Local Test Set...")
        # Dummy loss and accuracy
        return 0.5, 10, {"accuracy": 0.95}

def main():
    model = MedicalNet()
    
    print("--- Starting Hospital Client ---")
    
    # Connect to the Federated Server on Port 8080
    fl.client.start_numpy_client(
        server_address="127.0.0.1:8080", 
        client=HospitalClient(model)
    )

if __name__ == "__main__":
    main()