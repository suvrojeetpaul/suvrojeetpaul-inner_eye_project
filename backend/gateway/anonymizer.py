import pydicom

def clean_data(input_file, output_file):
    # Load the medical image
    ds = pydicom.dcmread(input_file)
    
    # DELETE identifying info
    ds.PatientName = "ANONYMIZED"
    ds.PatientID = "IE-101"
    
    # SAVE the clean file
    ds.save_as(output_file)