#!/bin/bash
# filepath: /workspaces/WoundTracker/fix-imports.sh

# Set the directory path
COMPONENTS_DIR="./src/components/ui"

echo "Starting import path fixer script..."

# Check if directory exists
if [ ! -d "$COMPONENTS_DIR" ]; then
  echo "Error: Components directory not found at $COMPONENTS_DIR"
  exit 1
fi

# Find all .tsx files in the components directory
FILES=$(find $COMPONENTS_DIR -name "*.tsx")
FILE_COUNT=$(echo "$FILES" | wc -l)

echo "Found $FILE_COUNT component files to check"

# Counter for modified files
MODIFIED_COUNT=0

# Process each file
for FILE in $FILES; do
  # Use sed to replace 'from "src/' with 'from "@/'
  # Create a temporary file
  sed -i 's/from ["'\''"]src\//from "@\//g' "$FILE"
  
  # Check if file was modified (grep returns 0 if match found)
  if [ $? -eq 0 ]; then
    echo "Fixing imports in $FILE"
    MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
  fi
done

echo "Import paths have been updated in $MODIFIED_COUNT files to use @/ instead of src/"
echo "Done!"